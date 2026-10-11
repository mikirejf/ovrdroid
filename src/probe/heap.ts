import { KIB, megabytes, MS_PER_SECOND, whole } from '../cli.ts';
import type { Fields } from './fields.ts';
import { fieldsOfJson, numberAt, worded } from './fields.ts';
import type { Point, Reading, Span } from './series.ts';
import { describeReading, maxOf, readSeries, sumOf } from './series.ts';

export const DEFAULT_BASELINE_S = 5;
const TOP_GROWTH = 10;

export interface HeapRow {
  t: number;
  pid: number;
  rss: number;
  heapUsed: number;
  heapTotal: number;
  external: number;
  arrayBuffers: number;
  jscHeap: number | undefined;
  jscCapacity: number | undefined;
  jscExtra: number | undefined;
  objects: number | undefined;
  top: ReadonlyMap<string, number> | undefined;
  costMs: number | undefined;
}

export interface SnapshotRow {
  t: number;
  pid: number;
  file: string;
  ms: number | undefined;
}

export interface HeapLog {
  series: ReadonlyMap<number, readonly HeapRow[]>;
  snapshots: readonly SnapshotRow[];
  failures: readonly string[];
}

export interface HeapSummary {
  pid: number;
  rows: number;
  windowMs: number;
  rss: Reading;
  jscHeap: Reading | undefined;
  external: Reading;
  arrayBuffers: Reading;
  objects: Reading | undefined;
  costMeanMs: number;
  costMaxMs: number;
}

export interface TypeGrowth {
  type: string;
  from: number;
  to: number;
  delta: number;
}

function countsOf(value: unknown): Map<string, number> | undefined {
  if (typeof value !== 'object' || value === null) {
    return undefined;
  }
  const counts = new Map<string, number>();
  for (const [type, count] of Object.entries(value)) {
    if (typeof count === 'number') {
      counts.set(type, count);
    }
  }
  return counts;
}

function rowOf(fields: Fields): HeapRow | undefined {
  const t = numberAt(fields, 't');
  const pid = numberAt(fields, 'pid');
  const rss = numberAt(fields, 'rss');
  if (t === undefined || pid === undefined || rss === undefined) {
    return undefined;
  }
  return {
    t,
    pid,
    rss,
    heapUsed: numberAt(fields, 'heapUsed') ?? 0,
    heapTotal: numberAt(fields, 'heapTotal') ?? 0,
    external: numberAt(fields, 'external') ?? 0,
    arrayBuffers: numberAt(fields, 'arrayBuffers') ?? 0,
    jscHeap: numberAt(fields, 'jscHeap'),
    jscCapacity: numberAt(fields, 'jscCapacity'),
    jscExtra: numberAt(fields, 'jscExtra'),
    objects: numberAt(fields, 'objects'),
    top: countsOf(fields.get('top')),
    costMs: numberAt(fields, 'costMs'),
  };
}

export function parseHeap(text: string): HeapLog {
  const series = new Map<number, HeapRow[]>();
  const snapshots: SnapshotRow[] = [];
  const failures: string[] = [];

  for (const line of text.split('\n')) {
    const fields = fieldsOfJson(line);
    const file = worded(fields, 'snapshot');
    const failed = worded(fields, 'snapshotFailed');
    const t = numberAt(fields, 't');
    const pid = numberAt(fields, 'pid');
    if (failed !== '') {
      failures.push(failed);
    } else if (file !== '' && t !== undefined && pid !== undefined) {
      snapshots.push({ t, pid, file, ms: numberAt(fields, 'ms') });
    } else {
      const row = rowOf(fields);
      if (row !== undefined) {
        series.set(row.pid, [...(series.get(row.pid) ?? []), row]);
      }
    }
  }

  const ordered = new Map<number, readonly HeapRow[]>();
  for (const [pid, rows] of series) {
    ordered.set(
      pid,
      rows.toSorted((a, b) => a.t - b.t),
    );
  }
  return { series: ordered, snapshots, failures };
}

export function mainPid(log: HeapLog): number | undefined {
  let best: [number, number] | undefined;
  for (const [pid, rows] of log.series) {
    if (best === undefined || rows.length > best[1]) {
      best = [pid, rows.length];
    }
  }
  return best?.[0];
}

function pointsOf(rows: readonly HeapRow[], pick: (row: HeapRow) => number | undefined): Point[] {
  return rows.flatMap((row) => {
    const value = pick(row);
    return value === undefined ? [] : [{ t: row.t, value }];
  });
}

export function summariseHeap(
  rows: readonly HeapRow[],
  baselineMs = DEFAULT_BASELINE_S * MS_PER_SECOND,
): HeapSummary | undefined {
  const first = rows.at(0);
  const last = rows.at(-1);
  const rss = readSeries(
    pointsOf(rows, (row) => row.rss),
    baselineMs,
  );
  const external = readSeries(
    pointsOf(rows, (row) => row.external),
    baselineMs,
  );
  const arrayBuffers = readSeries(
    pointsOf(rows, (row) => row.arrayBuffers),
    baselineMs,
  );
  if (
    first === undefined ||
    last === undefined ||
    rss === undefined ||
    external === undefined ||
    arrayBuffers === undefined
  ) {
    return undefined;
  }

  const costs = rows.flatMap((row) => (row.costMs === undefined ? [] : [row.costMs]));
  return {
    pid: first.pid,
    rows: rows.length,
    windowMs: last.t - first.t,
    rss,
    jscHeap: readSeries(
      pointsOf(rows, (row) => row.jscHeap),
      baselineMs,
    ),
    external,
    arrayBuffers,
    objects: readSeries(
      pointsOf(rows, (row) => row.objects),
      baselineMs,
    ),
    costMeanMs: costs.length === 0 ? 0 : sumOf(costs) / costs.length,
    costMaxMs: maxOf(costs),
  };
}

function censusAt(rows: readonly HeapRow[], t: number): HeapRow | undefined {
  const census = rows.filter((row) => row.top !== undefined);
  return census.findLast((row) => row.t <= t) ?? census.at(0);
}

export function typeGrowth(rows: readonly HeapRow[], span: Span, limit = TOP_GROWTH): TypeGrowth[] {
  const before = censusAt(rows, span.fromMs)?.top;
  const after = censusAt(rows, span.toMs)?.top;
  if (before === undefined || after === undefined) {
    return [];
  }

  const growth: TypeGrowth[] = [];
  for (const [type, to] of after) {
    const from = before.get(type) ?? 0;
    if (to > from) {
      growth.push({ type, from, to, delta: to - from });
    }
  }
  return growth.toSorted((a, b) => b.delta - a.delta).slice(0, limit);
}

function bytesText(bytes: number): string {
  return megabytes(bytes / KIB);
}

export function formatHeapSummary(summary: HeapSummary, firstT: number): string {
  const sized = { startT: firstT, text: bytesText };
  const lines = [
    `pid ${summary.pid}: ${summary.rows} rows over ${(summary.windowMs / MS_PER_SECOND).toFixed(1)}s`,
    describeReading('  rss       ', summary.rss, sized),
    describeReading('  external  ', summary.external, sized),
    describeReading('  arraybufs ', summary.arrayBuffers, sized),
  ];
  if (summary.jscHeap !== undefined) {
    lines.push(describeReading('  js heap   ', summary.jscHeap, sized));
  }
  if (summary.objects !== undefined) {
    lines.push(
      describeReading('  objects   ', summary.objects, {
        startT: firstT,
        text: (value) => whole(Math.round(value)),
      }),
    );
  }
  lines.push(
    `  sampler cost: ${summary.costMeanMs.toFixed(1)}ms per tick on average, ${summary.costMaxMs.toFixed(0)}ms at worst`,
  );
  return lines.join('\n');
}

export function formatTypeGrowth(growth: readonly TypeGrowth[]): string {
  if (growth.length === 0) {
    return '  no object type grew between those two samples';
  }
  return growth
    .map(
      (entry) =>
        `  ${entry.type.padEnd(28)} +${whole(entry.delta).padStart(9)}  (${whole(entry.from)} -> ${whole(entry.to)})`,
    )
    .join('\n');
}
