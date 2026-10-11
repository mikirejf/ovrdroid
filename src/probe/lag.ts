import { MS_PER_SECOND } from '../cli.ts';
import { fieldsOfJson, numberAt } from './fields.ts';
import type { Span } from './series.ts';
import { maxOf, meanOf, median } from './series.ts';

export interface LagRow {
  t: number;
  pid: number;
  n: number;
  p50: number;
  p99: number;
  max: number;
  busy: number;
}

export interface LagLog {
  series: ReadonlyMap<number, readonly LagRow[]>;
}

export interface LagSummary {
  rows: number;
  medianP99: number;
  worstMax: number;
  meanBusy: number;
}

function rowOf(line: string): LagRow | undefined {
  const fields = fieldsOfJson(line);
  const t = numberAt(fields, 't');
  const pid = numberAt(fields, 'pid');
  const n = numberAt(fields, 'n');
  const p50 = numberAt(fields, 'p50');
  const p99 = numberAt(fields, 'p99');
  const max = numberAt(fields, 'max');
  const busy = numberAt(fields, 'busy');
  if (
    t === undefined ||
    pid === undefined ||
    n === undefined ||
    p50 === undefined ||
    p99 === undefined ||
    max === undefined ||
    busy === undefined
  ) {
    return undefined;
  }
  return { t, pid, n, p50, p99, max, busy };
}

export function parseLag(text: string): LagLog {
  const series = new Map<number, LagRow[]>();
  for (const line of text.split('\n')) {
    const row = rowOf(line);
    if (row !== undefined) {
      series.set(row.pid, [...(series.get(row.pid) ?? []), row]);
    }
  }
  const ordered = new Map<number, readonly LagRow[]>();
  for (const [pid, rows] of series) {
    ordered.set(
      pid,
      rows.toSorted((a, b) => a.t - b.t),
    );
  }
  return { series: ordered };
}

export function rowsIn(rows: readonly LagRow[], span: Span): LagRow[] {
  return rows.filter((row) => row.t >= span.fromMs && row.t < span.toMs);
}

export function summariseLag(rows: readonly LagRow[]): LagSummary | undefined {
  const medianP99 = median(rows.map((row) => row.p99));
  const meanBusy = meanOf(rows.map((row) => row.busy));
  if (medianP99 === undefined || meanBusy === undefined) {
    return undefined;
  }
  return { rows: rows.length, medianP99, worstMax: maxOf(rows.map((row) => row.max)), meanBusy };
}

export function lagText(summary: LagSummary | undefined): string {
  if (summary === undefined) {
    return 'not measured';
  }
  const percent = (summary.meanBusy * 100).toFixed(1);
  return `median p99 ${summary.medianP99.toFixed(1)}ms, worst max ${summary.worstMax.toFixed(1)}ms, mean busy ${percent}%`;
}

export function formatLag(log: LagLog): string {
  if (log.series.size === 0) {
    return 'no lag rows: was the binary built with --lag and started with $OD_LAG set?';
  }
  return [...log.series.entries()]
    .toSorted(([, a], [, b]) => (a.at(0)?.t ?? 0) - (b.at(0)?.t ?? 0))
    .map(([pid, rows]) => {
      const first = rows.at(0)?.t ?? 0;
      const last = rows.at(-1)?.t ?? 0;
      return `pid ${pid}: ${rows.length} rows over ${((last - first) / MS_PER_SECOND).toFixed(0)}s: ${lagText(summariseLag(rows))}`;
    })
    .join('\n');
}
