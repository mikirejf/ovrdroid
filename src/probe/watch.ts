const KINDS = ['fsevent', 'schedule', 'status', 'cache-write'] as const;

export type WatchKind = (typeof KINDS)[number];

export interface WatchRow {
  atMs: number;
  kind: WatchKind;
  detail: string;
  subject: string;
}

export interface WatchReport {
  rows: readonly WatchRow[];
  relevantEvents: number;
  ignoredEvents: number;
  schedules: number;
  rescans: number;
  cacheWrites: number;
}

const DETAIL_AND_SUBJECT = 2;
const TIME_WIDTH = 8;
const KIND_WIDTH = 12;
const DETAIL_WIDTH = 10;
const GAP = '  ';

export const WATCH_HEADER = [
  'at'.padStart(TIME_WIDTH),
  'kind'.padEnd(KIND_WIDTH),
  'detail'.padEnd(DETAIL_WIDTH),
  'subject',
].join(GAP);

function parseLine(line: string): WatchRow | undefined {
  const [at = '', rawKind = '', ...rest] = line.split('\t');
  const atMs = Number(at);
  const kind = KINDS.find((known) => known === rawKind);
  if (Number.isNaN(atMs) || kind === undefined || rest.length === 0) {
    return undefined;
  }
  const labelled = rest.length >= DETAIL_AND_SUBJECT;
  return {
    atMs,
    kind,
    detail: labelled ? (rest[0] ?? '') : '',
    subject: (labelled ? rest.slice(1) : rest).join('\t'),
  };
}

export function parseWatch(text: string): WatchReport {
  const rows = text
    .split('\n')
    .map((line) => parseLine(line))
    .filter((row) => row !== undefined)
    .toSorted((a, b) => a.atMs - b.atMs);

  const events = rows.filter((row) => row.kind === 'fsevent');
  return {
    rows,
    relevantEvents: events.filter((row) => row.detail === 'relevant').length,
    ignoredEvents: events.filter((row) => row.detail === 'ignored').length,
    schedules: rows.filter((row) => row.kind === 'schedule').length,
    rescans: rows.filter((row) => row.kind === 'status' && row.detail.endsWith('->refreshing'))
      .length,
    cacheWrites: rows.filter((row) => row.kind === 'cache-write').length,
  };
}

export function formatWatch(rows: readonly WatchRow[]): string {
  return rows
    .map((row) =>
      [
        row.atMs.toFixed(0).padStart(TIME_WIDTH),
        row.kind.padEnd(KIND_WIDTH),
        row.detail.padEnd(DETAIL_WIDTH),
        row.subject,
      ].join(GAP),
    )
    .join('\n');
}

export function summariseWatch(report: WatchReport): string {
  return [
    `${report.relevantEvents} relevant file events (${report.ignoredEvents} ignored)`,
    `${report.schedules} watcher wake-ups`,
    `${report.rescans} catalog rescans`,
    `${report.cacheWrites} cache writes`,
  ].join(', ');
}
