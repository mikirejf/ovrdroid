import { fieldsOf, hasNumbers, parseJsonLines } from './fields.ts';

const SAMPLE_KEYS = [
  't',
  'pid',
  'commit',
  'build',
  'frame',
  'frameMs',
  'root',
  'list',
  'md',
  'bytes',
  'cpuUser',
  'cpuSystem',
] as const;

const MICROS_PER_MS = 1000;

export type CounterSample = Record<(typeof SAMPLE_KEYS)[number], number>;

export interface CounterWindow {
  commit: number;
  build: number;
  frame: number;
  frameMs: number;
  root: number;
  list: number;
  md: number;
  bytes: number;
  spanMs: number;
  cpuMs: number;
}

function isSample(value: unknown): value is CounterSample {
  return hasNumbers(fieldsOf(value), SAMPLE_KEYS);
}

export function parseCounters(text: string): CounterSample[] {
  return parseJsonLines(text, isSample);
}

export function busiestProcess<T extends { pid: number }>(lines: readonly T[]): T[] {
  const perProcess = Map.groupBy(lines, (line) => line.pid);
  const [busiest = []] = [...perProcess.values()].toSorted((a, b) => b.length - a.length);
  return busiest;
}

function soleProcess(samples: readonly CounterSample[]): void {
  const pids = new Set(samples.map((sample) => sample.pid));
  if (pids.size > 1) {
    throw new Error(
      `the samples come from ${pids.size} processes (${[...pids].join(', ')}); narrow them with busiestProcess first`,
    );
  }
}

export function windowOf(
  samples: readonly CounterSample[],
  from: number,
  to: number,
): CounterWindow {
  if (to < from) {
    throw new RangeError(`the window ends (${to}) before it starts (${from})`);
  }
  if (samples.length < 2) {
    throw new Error(`a window needs at least two samples, got ${samples.length}`);
  }
  soleProcess(samples);
  const ordered = samples.toSorted((a, b) => a.t - b.t);
  const first = ordered.at(0);
  const last = ordered.at(-1);
  const start = ordered.findLast((sample) => sample.t <= from) ?? first;
  const end = ordered.find((sample) => sample.t >= to) ?? last;
  if (start === undefined || end === undefined) {
    throw new Error('the window has no samples');
  }

  return {
    commit: end.commit - start.commit,
    build: end.build - start.build,
    frame: end.frame - start.frame,
    frameMs: end.frameMs - start.frameMs,
    root: end.root - start.root,
    list: end.list - start.list,
    md: end.md - start.md,
    bytes: end.bytes - start.bytes,
    spanMs: end.t - start.t,
    cpuMs: (end.cpuUser + end.cpuSystem - start.cpuUser - start.cpuSystem) / MICROS_PER_MS,
  };
}

export interface Span {
  from: number;
  to: number;
}

export type CounterWindows = Record<string, CounterWindow>;

export function span(fromMonotonicMs: number, toMonotonicMs: number): Span {
  return {
    from: performance.timeOrigin + fromMonotonicMs,
    to: performance.timeOrigin + toMonotonicMs,
  };
}

export function windowsOf(text: string, spans: Record<string, Span>): CounterWindows | undefined {
  const samples = busiestProcess(parseCounters(text));
  if (samples.length === 0) {
    return undefined;
  }
  return Object.fromEntries(
    Object.entries(spans).map(([name, { from, to }]) => [name, windowOf(samples, from, to)]),
  );
}

function counted(count: number, singular: string, plural = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : plural}`;
}

export function summariseWindow(window: CounterWindow): string {
  return [
    counted(window.commit, 'commit'),
    `${counted(window.frame, 'frame')} written (${window.build} built)`,
    counted(window.root, 'root render'),
    counted(window.list, 'message list render'),
    counted(window.md, 'markdown parse'),
    `${window.frameMs.toFixed(1)} ms building frames`,
    `${counted(window.bytes, 'byte')} to the terminal`,
    `${window.cpuMs.toFixed(0)} ms of CPU in ${window.spanMs.toFixed(0)} ms`,
  ].join(', ');
}
