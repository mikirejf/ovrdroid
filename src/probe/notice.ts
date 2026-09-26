import { randomUUID } from 'node:crypto';
import { readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

import { MS_PER_SECOND } from '../cli.ts';
import { FACTORY_SESSIONS } from '../paths.ts';
import type { Fields } from './fields.ts';
import { entriesOf, fieldsOf, worded } from './fields.ts';
import { ENTER, openSettledSession } from './session.ts';

const NOTICE_START = 'Background task ';
const OUTPUT_LINE = /\noutput: (?<output>[\s\S]*?)\n\nBackground task "/u;
const TASK_ID_LINE = /\ntask_id: (?<id>\S+)/u;
const TASK_PROMPT_START = '# Task Tool Invocation';
const NOTICE_TIMEOUT_MS = 240_000;
const POLL_MS = 1000;

export const DEFAULT_NOTICE_TYPE = 'explorer';

interface Entry {
  type: string;
  role: string;
  visibility: string;
  text: string;
}

export interface Notice {
  taskId: string;
  output: string;
}

export interface ChildTurn {
  report: string;
  hookRecords: number;
}

export interface NoticeReading {
  notice: Notice;
  child: ChildTurn | undefined;
}

function textOf(message: Fields): string {
  const content = message.get('content');
  if (typeof content === 'string') {
    return content;
  }
  return entriesOf(message, 'content')
    .filter((block) => worded(block, 'type') === 'text')
    .map((block) => worded(block, 'text'))
    .join('');
}

function entryOf(line: string): Entry {
  const fields = fieldsOf(JSON.parse(line));
  const message = fieldsOf(fields.get('message'));
  return {
    type: worded(fields, 'type'),
    role: worded(message, 'role'),
    visibility: worded(message, 'visibility'),
    text: textOf(message),
  };
}

function entriesIn(lines: readonly string[]): Entry[] {
  return lines.filter((line) => line.trim() !== '').map((line) => entryOf(line));
}

export function readNotice(lines: readonly string[], token: string): Notice | undefined {
  for (const { role, text } of entriesIn(lines)) {
    if (role !== 'user' || !text.startsWith(NOTICE_START) || !text.includes(token)) {
      continue;
    }
    const taskId = TASK_ID_LINE.exec(text)?.groups?.['id'];
    const output = OUTPUT_LINE.exec(text)?.groups?.['output'];
    if (taskId !== undefined && output !== undefined) {
      return { taskId, output };
    }
  }
  return undefined;
}

export function readChildTurn(lines: readonly string[]): ChildTurn | undefined {
  const messages = entriesIn(lines).filter((entry) => entry.type === 'message');
  const prompt = messages.findIndex(
    (entry) => entry.role === 'user' && entry.text.startsWith(TASK_PROMPT_START),
  );
  if (prompt === -1) {
    return undefined;
  }
  const turn = messages.slice(prompt + 1);
  const report = turn
    .filter((entry) => entry.role === 'assistant')
    .map((entry) => entry.text.trim())
    .findLast((text) => text !== '');
  const hookRecords = turn.filter(
    (entry) => entry.role === 'user' && entry.visibility === 'user_only',
  ).length;
  return { report: report ?? '', hookRecords };
}

export function describeNotice(reading: NoticeReading): string {
  const { notice, child } = reading;
  const lines = [`the completion notice for ${notice.taskId} said: ${notice.output}`];
  if (child === undefined) {
    lines.push('the subagent transcript was not found, so the notice cannot be checked');
    return lines.join('\n');
  }
  lines.push(
    child.report === ''
      ? 'the subagent wrote no report, so an empty notice would be correct'
      : `the subagent reported: ${child.report}`,
    child.hookRecords === 0
      ? 'no hook record sat inside the subagent turn, so this run did not exercise the bug'
      : `${child.hookRecords} hook record(s) sat inside the subagent turn`,
  );
  if (child.report !== '') {
    lines.push(
      notice.output === child.report
        ? 'the notice carried the report'
        : 'the notice lost the report the subagent wrote',
    );
  }
  return lines.join('\n');
}

export function noticeLostReport(reading: NoticeReading): boolean {
  return (
    reading.child !== undefined &&
    reading.child.report !== '' &&
    reading.notice.output !== reading.child.report
  );
}

function transcriptsSince(since: number): string[] {
  const found: string[] = [];
  for (const file of new Bun.Glob('*/*.jsonl').scanSync(FACTORY_SESSIONS)) {
    const full = path.join(FACTORY_SESSIONS, file);
    if (statSync(full).mtimeMs >= since) {
      found.push(full);
    }
  }
  return found;
}

function linesIn(file: string): string[] {
  return readFileSync(file, 'utf-8').split('\n');
}

function findNotice(since: number, token: string): Notice | undefined {
  for (const file of transcriptsSince(since)) {
    const notice = readNotice(linesIn(file), token);
    if (notice !== undefined) {
      return notice;
    }
  }
  return undefined;
}

function childLines(taskId: string): string[] | undefined {
  for (const file of new Bun.Glob(`*/${taskId}.jsonl`).scanSync(FACTORY_SESSIONS)) {
    return linesIn(path.join(FACTORY_SESSIONS, file));
  }
  return undefined;
}

function parentPrompt(type: string, cwd: string, token: string): string {
  const reply = `${token} done`;
  return (
    `Launch exactly one background Task (do not await it) with subagent_type "${type}" and ` +
    `description "${token}". Its prompt: "Your first action must be one Read tool call on ` +
    `${path.join(cwd, 'package.json')} with limit 1. Write no text before it. After it returns, ` +
    `reply with exactly: ${reply}". Then end your turn without any other tool call.`
  );
}

export interface NoticeOptions {
  cwd: string;
  type: string;
}

export async function runNotice(binary: string, options: NoticeOptions): Promise<NoticeReading> {
  const token = `NOTICE-${randomUUID().slice(0, 8)}`;
  const since = Date.now();
  const { session } = await openSettledSession(binary, { cwd: options.cwd, collect: false });
  try {
    session.paste(parentPrompt(options.type, options.cwd, token));
    await session.type(ENTER);

    const deadline = performance.now() + NOTICE_TIMEOUT_MS;
    while (performance.now() < deadline) {
      const notice = findNotice(since, token);
      if (notice !== undefined) {
        const lines = childLines(notice.taskId);
        return { notice, child: lines === undefined ? undefined : readChildTurn(lines) };
      }
      // oxlint-disable-next-line no-await-in-loop
      await delay(POLL_MS);
    }
    throw new Error(`no completion notice within ${NOTICE_TIMEOUT_MS / MS_PER_SECOND}s`);
  } finally {
    await session.close();
  }
}
