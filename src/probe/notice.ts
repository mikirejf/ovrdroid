import { randomUUID } from 'node:crypto';
import { readFileSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

import { hasErrorCode, MS_PER_SECOND } from '../cli.ts';
import { FACTORY_SESSIONS } from '../paths.ts';
import { withTempDir } from '../temp.ts';
import type { Fields } from './fields.ts';
import { entriesOf, fieldsOf, worded } from './fields.ts';
import { PROBE_SETTINGS } from './launch.ts';
import { transcriptFileOf } from './live-transcript.ts';
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
      ? 'the subagent wrote no report, so this run did not exercise the bug'
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

export type NoticeVerdict = 'carried' | 'lost' | 'unproven';

export function noticeVerdict({ notice, child }: NoticeReading): NoticeVerdict {
  if (child !== undefined && child.report !== '' && notice.output !== child.report) {
    return 'lost';
  }
  if (child === undefined || child.report === '' || child.hookRecords === 0) {
    return 'unproven';
  }
  return 'carried';
}

const READ_HOOK_TIMEOUT_S = 5;

export function noticeSettings() {
  return {
    ...PROBE_SETTINGS,
    hooks: {
      ...PROBE_SETTINGS.hooks,
      PreToolUse: [
        {
          matcher: 'Read',
          hooks: [{ type: 'command', command: 'cat > /dev/null', timeout: READ_HOOK_TIMEOUT_S }],
        },
      ],
    },
  };
}

function linesIn(file: string): string[] {
  return readFileSync(file, 'utf-8').split('\n');
}

function linesIfWrittenSince(file: string, since: number): string[] | undefined {
  try {
    return statSync(file).mtimeMs >= since ? linesIn(file) : undefined;
  } catch (error) {
    if (hasErrorCode(error, 'ENOENT')) {
      return undefined;
    }
    throw error;
  }
}

function findNotice(since: number, token: string): Notice | undefined {
  for (const file of new Bun.Glob('*/*.jsonl').scanSync(FACTORY_SESSIONS)) {
    const lines = linesIfWrittenSince(path.join(FACTORY_SESSIONS, file), since);
    const notice = lines === undefined ? undefined : readNotice(lines, token);
    if (notice !== undefined) {
      return notice;
    }
  }
  return undefined;
}

function childLines(taskId: string): string[] | undefined {
  const file = transcriptFileOf(taskId);
  return file === undefined ? undefined : linesIn(file);
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

async function observeNotice(
  binary: string,
  options: NoticeOptions,
  settingsFile: string,
): Promise<NoticeReading> {
  const token = `NOTICE-${randomUUID().slice(0, 8)}`;
  const since = Date.now();
  const { session } = await openSettledSession(binary, {
    cwd: options.cwd,
    collect: false,
    env: { FACTORY_RUNTIME_SETTINGS_PATH: settingsFile },
  });
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

export async function runNotice(binary: string, options: NoticeOptions): Promise<NoticeReading> {
  return await withTempDir('notice', async (dir) => {
    const settingsFile = path.join(dir, 'settings.json');
    writeFileSync(settingsFile, JSON.stringify(noticeSettings()));
    return await observeNotice(binary, options, settingsFile);
  });
}
