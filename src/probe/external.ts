import path from 'node:path';

import { whole } from '../cli.ts';
import { entriesOf, fieldsOf, isObject, worded } from './fields.ts';
import type { Fields } from './fields.ts';

const REFUSAL_MARK = 'has been modified externally since it was last read';
const REMINDER_MARK = 'modified externally since you last accessed';
const LISTED_PATH = /^ {2}- (?<file>.+)$/gmu;
const SINGLE_PATH =
  /The file (?<file>.+?) has been modified externally since you last accessed it/u;
const REFUSED_PATH = /File "(?<file>.+?)" has been modified externally/u;
const SHELL_WRITE =
  /sed -i|perl -pi|\bcp\b|\bmv\b|(?<![\d=-])>>?\s*(?!&|\/dev\/null)\S|\btee\b|\bpython3? |\bnode |\bbun |\bpatch\b/u;
const GIT_REWRITE =
  /\bgit\b[^|;&]*\s(?:checkout|restore|stash|reset|rebase|merge|pull|commit|apply|cherry-pick|switch|am)\b/u;
const FORMATTER = /format|fmt|prettier|oxfmt|biome|--fix|--write|lint:fix|codemod/u;
const ACCESS_TOOLS: ReadonlySet<string> = new Set(['Read', 'Edit', 'Create']);
const EXAMPLES_PER_CAUSE = 3;
const SESSION_PREFIX_CHARS = 8;

export const CAUSES = [
  'shell-edit',
  'git',
  'formatter',
  'subagent',
  'other-shell',
  'nothing',
] as const;

export type Cause = (typeof CAUSES)[number];
export type EventKind = 'refusal' | 'reminder';

const CAUSE_WORDS: Record<Cause, string> = {
  'shell-edit': "the agent's own shell command edited the file",
  git: 'the agent ran a git command that can rewrite files',
  formatter: 'the agent ran a formatter or fixer',
  subagent: 'the agent started a subagent',
  'other-shell': 'the agent ran shell commands that did not name the file',
  nothing: 'the agent did nothing since it last read the file',
};

export interface Finding {
  kind: EventKind;
  file: string;
  cause: Cause;
}

export interface Reading {
  findings: Finding[];
  repeated: number;
}

export interface SessionReading {
  session: string;
  reading: Reading;
}

export interface Example {
  session: string;
  file: string;
}

export interface CauseTally {
  cause: Cause;
  count: number;
  examples: Example[];
}

export interface Tally {
  total: number;
  sessions: number;
  causes: CauseTally[];
}

export interface Summary {
  refusals: Tally;
  reminders: Tally;
  repeated: number;
}

interface AgentCall {
  name: string;
  text: string;
}

interface Access {
  file: string;
  index: number;
}

function resultText(block: Fields): string {
  const content = block.get('content');
  if (typeof content === 'string') {
    return content;
  }
  return entriesOf(block, 'content')
    .map((part) => worded(part, 'text'))
    .join('\n');
}

function classify(window: readonly AgentCall[], file: string): Cause {
  const name = path.basename(file);
  const shell = window.filter((call) => call.name === 'Execute');
  if (shell.some((call) => call.text.includes(name) && SHELL_WRITE.test(call.text))) {
    return 'shell-edit';
  }
  if (shell.some((call) => GIT_REWRITE.test(call.text))) {
    return 'git';
  }
  if (shell.some((call) => FORMATTER.test(call.text))) {
    return 'formatter';
  }
  if (window.some((call) => call.name === 'Task')) {
    return 'subagent';
  }
  return shell.length > 0 ? 'other-shell' : 'nothing';
}

function warnedFiles(text: string): string[] {
  const listed = [...text.matchAll(LISTED_PATH)].map((match) => match.groups?.['file']?.trim());
  const single = SINGLE_PATH.exec(text)?.groups?.['file'];
  return [...listed, single].filter((file): file is string => file !== undefined && file !== '');
}

class Transcript {
  readonly calls: AgentCall[] = [];
  readonly lastAccess = new Map<string, number>();
  readonly warned = new Set<string>();
  readonly pending = new Map<string, Access>();
  readonly findings: Finding[] = [];
  repeated = 0;

  record(kind: EventKind, file: string): void {
    const window = this.calls.slice(this.lastAccess.get(file) ?? 0);
    this.findings.push({ kind, file, cause: classify(window, file) });
  }

  useTool(block: Fields): void {
    const name = worded(block, 'name');
    const input = fieldsOf(block.get('input'));
    this.calls.push({ name, text: worded(input, 'command') || worded(input, 'prompt') });
    const file = worded(input, 'file_path');
    if (ACCESS_TOOLS.has(name) && file !== '') {
      this.pending.set(worded(block, 'id'), { file, index: this.calls.length });
    }
  }

  takeResult(block: Fields): void {
    const text = resultText(block);
    const access = this.pending.get(worded(block, 'tool_use_id'));
    if (block.get('is_error') !== true) {
      if (access !== undefined) {
        this.lastAccess.set(access.file, access.index);
        this.warned.delete(access.file);
      }
      return;
    }
    if (text.includes(REFUSAL_MARK)) {
      const file = access?.file ?? REFUSED_PATH.exec(text)?.groups?.['file'] ?? '';
      this.record('refusal', file);
    }
  }

  takeText(text: string): void {
    if (!text.includes(REMINDER_MARK)) {
      return;
    }
    for (const file of warnedFiles(text)) {
      if (this.warned.has(file)) {
        this.repeated += 1;
      } else {
        this.warned.add(file);
        this.record('reminder', file);
      }
    }
  }

  take(block: Fields, role: string): void {
    const type = worded(block, 'type');
    if (type === 'tool_use') {
      this.useTool(block);
    } else if (type === 'tool_result') {
      this.takeResult(block);
    } else if (type === 'text' && role === 'user') {
      this.takeText(worded(block, 'text'));
    }
  }
}

function parseLine(line: string): Fields | undefined {
  try {
    const parsed: unknown = JSON.parse(line);
    return isObject(parsed) ? fieldsOf(parsed) : undefined;
  } catch {
    return undefined;
  }
}

export function readExternal(lines: readonly string[]): Reading {
  const transcript = new Transcript();
  for (const line of lines) {
    const parsed = parseLine(line);
    if (parsed === undefined) {
      continue;
    }
    const message = fieldsOf(parsed.get('message'));
    const role = worded(message, 'role');
    for (const block of entriesOf(message, 'content')) {
      transcript.take(block, role);
    }
  }
  return { findings: transcript.findings, repeated: transcript.repeated };
}

function tallyOf(kind: EventKind, readings: readonly SessionReading[]): Tally {
  const causes = new Map<Cause, CauseTally>();
  const sessions = new Set<string>();
  let total = 0;
  for (const { session, reading } of readings) {
    for (const finding of reading.findings.filter((found) => found.kind === kind)) {
      total += 1;
      sessions.add(session);
      const tally = causes.get(finding.cause) ?? { cause: finding.cause, count: 0, examples: [] };
      tally.count += 1;
      if (tally.examples.length < EXAMPLES_PER_CAUSE) {
        tally.examples.push({
          session: session.slice(0, SESSION_PREFIX_CHARS),
          file: path.basename(finding.file),
        });
      }
      causes.set(finding.cause, tally);
    }
  }
  const ranked = CAUSES.flatMap((cause) => causes.get(cause) ?? []).toSorted(
    (left, right) => right.count - left.count,
  );
  return { total, sessions: sessions.size, causes: ranked };
}

export function summariseExternal(readings: readonly SessionReading[]): Summary {
  return {
    refusals: tallyOf('refusal', readings),
    reminders: tallyOf('reminder', readings),
    repeated: readings.reduce((sum, { reading }) => sum + reading.repeated, 0),
  };
}

function describeTally(headline: string, tally: Tally): string[] {
  const lines = [`${headline}: ${whole(tally.total)} in ${whole(tally.sessions)} sessions`];
  for (const { cause, count, examples } of tally.causes) {
    lines.push(
      `${String(count).padStart(6)}  ${CAUSE_WORDS[cause]}`,
      `        e.g. ${examples.map((example) => `${example.session} ${example.file}`).join(', ')}`,
    );
  }
  return lines;
}

export function describeExternal(summary: Summary): string {
  return [
    ...describeTally('Edits refused because a file looked changed', summary.refusals),
    '',
    ...describeTally('Files Droid warned about as modified externally', summary.reminders),
    '',
    `${whole(summary.repeated)} more warnings named a file the agent had not read again since the first one`,
  ].join('\n');
}
