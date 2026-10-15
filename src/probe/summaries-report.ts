import { isSummary, summaryBody } from '../patch/summary-format.ts';
import { fieldsOfJson, numberAt, worded } from './fields.ts';

export interface CompactionRecord {
  sessionId: string;
  subagent: boolean;
  timestamp: string;
  text: string;
}

export interface CompactRow {
  at: number;
  sessionId: string;
  model: string;
  path: string;
  head: string;
}

export const JOIN_WINDOW_MS = 120_000;
export const PREVIEW_CHARS = 100;
export const NO_LOG_LINE = 'no log line';
export const UNKNOWN_MODEL = 'unknown';

const COMPACTION_MARKER = '"compaction_state"';
const COMPACT_MARKER = '"compact"';
const STORED_KIND = 'llm_summary';
const PATH_ORDER = [
  'reuse',
  'reuse-extended',
  'no-snapshot',
  'other-model',
  'prefix-mismatch',
  'unseen-messages',
  'tool-call',
  'empty',
  'error',
  'not-summary',
  NO_LOG_LINE,
];
const GAP = '  ';
const TABLE_HEADING = ['path', 'summaries', 'not summaries'];

export function parseCompactRow(line: string): CompactRow | undefined {
  if (!line.includes(COMPACT_MARKER)) {
    return undefined;
  }
  const fields = fieldsOfJson(line);
  const at = numberAt(fields, 't');
  const sessionId = worded(fields, 's');
  const model = worded(fields, 'm');
  const path = worded(fields, 'compact');
  if (at === undefined || sessionId === '' || model === '' || path === '') {
    return undefined;
  }
  return { at, sessionId, model, path, head: worded(fields, 'head') };
}

function compactionOf(
  line: string,
  owner: Pick<CompactionRecord, 'sessionId' | 'subagent'>,
  since: number,
): CompactionRecord | undefined {
  const fields = fieldsOfJson(line);
  const timestamp = worded(fields, 'timestamp');
  const at = Date.parse(timestamp);
  if (
    worded(fields, 'type') !== 'compaction_state' ||
    worded(fields, 'summaryKind') !== STORED_KIND ||
    Number.isNaN(at) ||
    at < since
  ) {
    return undefined;
  }
  return { ...owner, timestamp, text: worded(fields, 'summaryText') };
}

export function compactionsOf(
  sessionId: string,
  text: string,
  since = Number.NEGATIVE_INFINITY,
): CompactionRecord[] {
  if (!text.includes(COMPACTION_MARKER)) {
    return [];
  }
  const lines = text.split('\n');
  const header = fieldsOfJson(lines[0] ?? '');
  const owner = { sessionId, subagent: worded(header, 'callingSessionId') !== '' };
  return lines
    .filter((line) => line.includes(COMPACTION_MARKER))
    .map((line) => compactionOf(line, owner, since))
    .filter((record) => record !== undefined);
}

interface Judged {
  record: CompactionRecord;
  at: number;
  model: string;
  path: string;
  real: boolean;
}

function rowsBySession(rows: readonly CompactRow[]): Map<string, CompactRow[]> {
  const bySession = new Map<string, CompactRow[]>();
  for (const row of rows.toSorted((a, b) => a.at - b.at)) {
    const list = bySession.get(row.sessionId) ?? [];
    list.push(row);
    bySession.set(row.sessionId, list);
  }
  return bySession;
}

function judge(record: CompactionRecord, rows: readonly CompactRow[]): Judged {
  const at = Date.parse(record.timestamp);
  const match = rows.findLast((row) => row.at <= at && at - row.at <= JOIN_WINDOW_MS);
  return {
    record,
    at,
    model: match?.model ?? UNKNOWN_MODEL,
    path: match?.path ?? NO_LOG_LINE,
    real: isSummary(summaryBody(record.text)),
  };
}

function pathRank(path: string): number {
  const rank = PATH_ORDER.indexOf(path);
  return rank === -1 ? PATH_ORDER.length : rank;
}

function tableOf(judged: readonly Judged[]): string[] {
  const tally = new Map<string, { real: number; flagged: number }>();
  for (const { path, real } of judged) {
    const counts = tally.get(path) ?? { real: 0, flagged: 0 };
    counts[real ? 'real' : 'flagged'] += 1;
    tally.set(path, counts);
  }
  const body = [...tally]
    .toSorted(([a], [b]) => pathRank(a) - pathRank(b) || a.localeCompare(b))
    .map(([path, counts]) => [path, String(counts.real), String(counts.flagged)]);
  const rows = [TABLE_HEADING, ...body];
  const widths = TABLE_HEADING.map((heading, column) =>
    Math.max(...rows.map((cells) => cells[column]?.length ?? 0), heading.length),
  );
  return rows.map((cells) =>
    cells
      .map((cell, column) =>
        column === 0 ? cell.padEnd(widths[column] ?? 0) : cell.padStart(widths[column] ?? 0),
      )
      .join(GAP),
  );
}

function flaggedLine(entry: Judged): string {
  const { record } = entry;
  const preview = record.text.replaceAll(/\s+/gu, ' ').trim().slice(0, PREVIEW_CHARS);
  return [
    record.sessionId,
    record.timestamp,
    record.subagent ? 'subagent' : 'main',
    entry.model,
    entry.path,
    `${record.text.length} chars`,
    preview,
  ].join(GAP);
}

function listOf(items: readonly string[]): string {
  return items.length < 2
    ? items.join('')
    : `${items.slice(0, -1).join(', ')} and ${items.at(-1) ?? ''}`;
}

function verdictOf(judged: readonly Judged[]): string {
  if (judged.length === 0) {
    return 'no stored summaries were found in that range';
  }
  const flagged = judged.filter((entry) => !entry.real);
  const head = `the check flags ${flagged.length} of ${judged.length} summaries`;
  if (flagged.length === 0) {
    return head;
  }
  const paths = [...Map.groupBy(flagged, (entry) => entry.path)]
    .toSorted(([a], [b]) => pathRank(a) - pathRank(b) || a.localeCompare(b))
    .map(([path, entries]) => ({ path, count: entries.length }));
  const [only] = paths;
  if (paths.length === 1 && only !== undefined) {
    return `${head}; every flagged one came out of ${only.path}`;
  }
  return `${head}; they came out of ${listOf(paths.map(({ path, count }) => `${path} (${count})`))}`;
}

export function summariesReport(
  compactions: readonly CompactionRecord[],
  rows: readonly CompactRow[],
): string[] {
  const bySession = rowsBySession(rows);
  const judged = compactions
    .map((record) => judge(record, bySession.get(record.sessionId) ?? []))
    .toSorted((a, b) => a.at - b.at);
  const flagged = judged.filter((entry) => !entry.real);
  return [
    ...(judged.length === 0 ? [] : [...tableOf(judged), '']),
    ...(flagged.length === 0 ? [] : [...flagged.map((entry) => flaggedLine(entry)), '']),
    `${verdictOf(judged)}.`,
  ];
}
