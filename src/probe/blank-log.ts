import type { Fields } from './fields.ts';
import { fieldsOfJson } from './fields.ts';

const CONTEXT_MS = 5000;
const AFTER_COMPACTION_MS = 30_000;
const STACK_TOP_FRAMES = 3;
const MS_PER_SECOND = 1000;
const TIME_START = 11;
const TIME_END = 23;
const UNITS = new Map([
  ['s', 1000],
  ['m', 60_000],
  ['h', 3_600_000],
  ['d', 86_400_000],
]);
const DURATION = /^(?<amount>\d+(?:\.\d+)?)(?<unit>[smhd])$/u;

export interface BlankRow {
  at: number;
  pid: number;
  event: string;
  sid: string | null;
  agentScope: string | null;
  detail: Fields;
  stack: string | undefined;
}

export interface ParsedLog {
  rows: BlankRow[];
  unreadable: number;
}

interface Compaction {
  at: number;
  path: string;
  target: string | undefined;
}

interface Ended {
  at: number;
  path: string;
  outcome: string;
}

const FOCUS = new Set(['empty-render', 'static-reset']);
const CONTEXT = new Set(['scoped-read', 'epoch-reset', 'session-drop']);
const OWN_FIELDS = new Set(['t', 'pid', 'event', 'sid', 'agentScope', 'stack']);

const CLEAR_ACTIONS = new Map([
  ['rebuild', 'the terminal was cleared and the history reprinted'],
  [
    'clear-reset',
    'the terminal was cleared and the static output reset (surface handoff or transcript open)',
  ],
]);

function textAt(fields: Fields, name: string): string | undefined {
  const value = fields.get(name);
  return typeof value === 'string' ? value : undefined;
}

function rowOf(line: string): BlankRow | undefined {
  const fields = fieldsOfJson(line);
  const at = Date.parse(textAt(fields, 't') ?? '');
  const event = textAt(fields, 'event');
  if (!Number.isFinite(at) || event === undefined) {
    return undefined;
  }
  const pid = fields.get('pid');
  return {
    at,
    pid: typeof pid === 'number' ? pid : 0,
    event,
    sid: textAt(fields, 'sid') ?? null,
    agentScope: textAt(fields, 'agentScope') ?? null,
    detail: new Map([...fields].filter(([key]) => !OWN_FIELDS.has(key))),
    stack: textAt(fields, 'stack'),
  };
}

export function parseBlankLog(content: string): ParsedLog {
  const rows: BlankRow[] = [];
  let unreadable = 0;
  for (const line of content.split('\n').filter((entry) => entry.trim() !== '')) {
    const row = rowOf(line);
    if (row === undefined) {
      unreadable += 1;
    } else {
      rows.push(row);
    }
  }
  return { rows: rows.toSorted((a, b) => a.at - b.at), unreadable };
}

export function parseSince(raw: string, now: number): number {
  const match = DURATION.exec(raw);
  const unit = UNITS.get(match?.groups?.['unit'] ?? '');
  if (match !== null && unit !== undefined) {
    return now - Number(match.groups?.['amount']) * unit;
  }
  const at = Date.parse(raw);
  if (!Number.isFinite(at)) {
    throw new TypeError(`--since takes a duration like 30m, 2h or 1d, or a date: ${raw}`);
  }
  return at;
}

function clock(at: number): string {
  return new Date(at).toISOString().slice(TIME_START, TIME_END);
}

function secondsBetween(from: number, to: number): string {
  return `${((to - from) / MS_PER_SECOND).toFixed(1)}s`;
}

function field(row: BlankRow, key: string): string {
  const value = row.detail.get(key);
  return typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean'
    ? String(value)
    : '?';
}

function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? '' : 's'}`;
}

function stackTop(row: BlankRow): string | undefined {
  const frames = (row.stack ?? '')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '')
    .slice(0, STACK_TOP_FRAMES);
  return frames.length === 0 ? undefined : frames.join(' < ');
}

function whatHappened(row: BlankRow): string {
  if (row.event === 'empty-render') {
    const manager = row.detail.get('managerFound') === true ? 'found' : 'missing';
    return (
      `the message list of session ${row.sid ?? '?'} went from ${field(row, 'previous')} messages to 0 ` +
      `(session manager ${manager}, effort ${field(row, 'effort')}, working state ${field(row, 'working')})`
    );
  }
  const action = CLEAR_ACTIONS.get(field(row, 'kind')) ?? 'the terminal was cleared';
  const cause = field(row, 'cause');
  return cause === 'unattributed' || cause === '?'
    ? `${action}, with no recorded cause (transcript exit, stacked toggle or another caller)`
    : `${action} for ${cause}`;
}

function scopeOf(row: BlankRow): string {
  return row.agentScope === null
    ? 'outside any agent scope'
    : `while an agent scope (session ${row.agentScope}) was active`;
}

function compactionOf(
  row: BlankRow,
  open: readonly Compaction[],
  ended: Ended | undefined,
): string {
  const running = open.at(-1);
  if (running !== undefined) {
    const target = running.target === undefined ? '' : ` for session ${running.target}`;
    return `during the ${running.path} compaction${target} started ${secondsBetween(running.at, row.at)} earlier`;
  }
  if (ended !== undefined && row.at - ended.at <= AFTER_COMPACTION_MS) {
    return `${secondsBetween(ended.at, row.at)} after a ${ended.path} compaction ended (${ended.outcome})`;
  }
  return 'with no compaction running';
}

function contextOf(row: BlankRow, before: readonly BlankRow[]): string | undefined {
  const near = before.filter((other) => row.at - other.at <= CONTEXT_MS);
  if (near.length === 0) {
    return undefined;
  }
  const scoped = near.filter((other) => other.event === 'scoped-read').length;
  const parts = [
    ...(scoped > 0
      ? [`${plural(scoped, 'scoped read')} of a session the agent adapter lacks`]
      : []),
    ...near
      .filter((other) => other.event === 'epoch-reset')
      .map((other) => `an epoch reset for ${field(other, 'reason')}`),
    ...near
      .filter((other) => other.event === 'session-drop')
      .map((other) => `a session drop via ${field(other, 'via')} of ${field(other, 'target')}`),
  ];
  return `in the ${CONTEXT_MS / MS_PER_SECOND}s before: ${parts.join(', ')}`;
}

function summaryOf(rows: readonly BlankRow[], unreadable: number): string {
  const tally = (event: string): number => rows.filter((row) => row.event === event).length;
  const starts = rows.filter(
    (row) => row.event === 'compaction' && row.detail.get('phase') === 'start',
  ).length;
  const first = rows.at(0);
  const last = rows.at(-1);
  const span =
    first === undefined || last === undefined
      ? ''
      : ` from ${new Date(first.at).toISOString()} to ${new Date(last.at).toISOString()}`;
  const skipped = unreadable > 0 ? `, ${plural(unreadable, 'unreadable line')} skipped` : '';
  return (
    `${rows.length} log lines${span}: ${tally('empty-render')} empty renders, ${tally('static-reset')} terminal clears, ` +
    `${tally('epoch-reset')} epoch resets, ${tally('scoped-read')} scoped reads, ${tally('session-drop')} session drops, ` +
    `${starts} compactions started${skipped}`
  );
}

export function describeBlankLog(log: ParsedLog): string[] {
  const lines = [summaryOf(log.rows, log.unreadable)];
  const open: Compaction[] = [];
  const context: BlankRow[] = [];
  let ended: Ended | undefined;
  for (const row of log.rows) {
    if (row.event === 'compaction') {
      const path = field(row, 'path');
      if (row.detail.get('phase') === 'start') {
        open.push({ at: row.at, path, target: textAt(row.detail, 'target') });
      } else {
        const index = open.findLastIndex((entry) => entry.path === path);
        open.splice(index === -1 ? open.length - 1 : index, 1);
        ended = { at: row.at, path, outcome: field(row, 'outcome') };
      }
    } else if (CONTEXT.has(row.event)) {
      context.push(row);
    } else if (FOCUS.has(row.event)) {
      const pieces = [
        `${clock(row.at)} pid ${row.pid}: ${whatHappened(row)}`,
        scopeOf(row),
        compactionOf(row, open, ended),
      ];
      const near = contextOf(row, context);
      const top = stackTop(row);
      lines.push(
        `${pieces.join(', ')}${near === undefined ? '' : `; ${near}`}${top === undefined ? '' : `; stack top: ${top}`}`,
      );
    }
  }
  if (lines.length === 1) {
    lines.push('No empty render or terminal clear was logged in this window.');
  }
  return lines;
}
