export type TraceKind = 'joined' | 'detached' | 'boundary';

export interface TraceRow {
  phase: string;
  kind: TraceKind;
  startMs: number;
  endMs: number;
}

interface RawRow extends TraceRow {
  pid: string;
}

const COLUMNS = 5;
const TIME_WIDTH = 9;
const KIND_WIDTH = 9;
const GAP = '  ';

export const TRACE_HEADER = [
  'start'.padStart(TIME_WIDTH),
  'end'.padStart(TIME_WIDTH),
  'duration'.padStart(TIME_WIDTH),
  'kind'.padEnd(KIND_WIDTH),
  'phase',
].join(GAP);

function kindOf(value: string): TraceKind {
  return value === 'detached' || value === 'boundary' ? value : 'joined';
}

function parseLine(line: string): RawRow | undefined {
  const parts = line.split('\t');
  if (parts.length !== COLUMNS) {
    return undefined;
  }
  const [pid = '', phase = '', join = '', start = '', end = ''] = parts;
  const startMs = Number(start);
  const endMs = Number(end);
  if (Number.isNaN(startMs) || Number.isNaN(endMs)) {
    return undefined;
  }
  return { pid, phase, kind: kindOf(join), startMs, endMs };
}

export function parseTrace(text: string): TraceRow[] {
  const raw = text
    .split('\n')
    .map((line) => parseLine(line))
    .filter((row) => row !== undefined);
  const owner = raw.find((row) => row.phase === 'first_paint')?.pid ?? raw[0]?.pid;

  return raw
    .filter((row) => row.pid === owner)
    .map(({ pid: _pid, ...row }) => row)
    .toSorted((a, b) => a.startMs - b.startMs);
}

export function formatTrace(rows: readonly TraceRow[]): string {
  return rows
    .map((row) =>
      [
        row.startMs.toFixed(1).padStart(TIME_WIDTH),
        row.endMs.toFixed(1).padStart(TIME_WIDTH),
        (row.endMs - row.startMs).toFixed(1).padStart(TIME_WIDTH),
        row.kind.padEnd(KIND_WIDTH),
        row.phase,
      ].join(GAP),
    )
    .join('\n');
}
