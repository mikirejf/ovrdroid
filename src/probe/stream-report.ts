import { kilobytes } from '../cli.ts';
import type { Series } from './ab.ts';
import { summarise } from './ab.ts';
import type { Sample } from './idle.ts';
import type { Measure } from './regressions.ts';
import { failOnRegressions } from './regressions.ts';
import type { Frame } from './session.ts';
import { STUB_END } from './stub-model.ts';

export interface StreamReading {
  cpuMs: number;
  wallMs: number;
  askMs: number;
  lagMs: number;
  frames: number;
  bytes: number;
  streamMs: number;
}

export interface StreamInputs {
  frames: readonly Frame[];
  bytes: number;
  head: readonly Sample[];
  tail: readonly Sample[];
  streamStartMs: number;
  streamEndMs: number;
}

export function treeCpuMs(head: readonly Sample[], tail: readonly Sample[]): number {
  const before = new Map(head.map((sample) => [sample.pid, sample.cpuMs] as const));
  return tail.reduce((total, sample) => total + sample.cpuMs - (before.get(sample.pid) ?? 0), 0);
}

export function readStream(inputs: StreamInputs): StreamReading {
  const landed = inputs.frames.find((frame) => frame.text.includes(STUB_END));
  if (landed === undefined) {
    throw new Error(`the last line of the stub reply ("${STUB_END}") never showed in a frame`);
  }
  return {
    cpuMs: treeCpuMs(inputs.head, inputs.tail),
    wallMs: landed.atMs,
    askMs: inputs.streamStartMs,
    lagMs: landed.atMs - inputs.streamEndMs,
    frames: inputs.frames.length,
    bytes: inputs.bytes,
    streamMs: inputs.streamEndMs - inputs.streamStartMs,
  };
}

type Metric = keyof StreamReading;

const ROWS: readonly (readonly [Metric, string, string])[] = [
  ['cpuMs', 'cpu', 'ms of CPU across the Droid process tree'],
  ['wallMs', 'wall', 'ms from Enter until the reply ends on screen'],
  ['askMs', 'ask', 'ms from Enter until the stub got the request'],
  ['lagMs', 'lag', 'ms the screen trailed the end of the stream'],
  ['frames', 'frames', 'frames written'],
  ['bytes', 'bytes', 'bytes written to the terminal'],
  ['streamMs', 'stream', 'ms the stub spent streaming'],
];

export function formatRuns(binary: string, runs: readonly StreamReading[]): string {
  const lines = ['', binary];
  for (const [metric, label, unit] of ROWS) {
    const values = runs.map((run) => run[metric]);
    lines.push(`  ${label.padEnd(7)}${summarise(values)}  ${unit}`);
  }
  const last = runs.at(-1);
  if (last !== undefined && last.frames > 0) {
    lines.push(
      `  last run wrote ${kilobytes(last.bytes)} in ${last.frames} frames, ${kilobytes(last.bytes / last.frames)} per frame`,
    );
  }
  return lines.join('\n');
}

export function seriesOf(results: Series<StreamReading>, metric: Metric): Series<number> {
  return results.map(([binary, runs]) => [binary, runs.map((run) => run[metric])]);
}

export const STREAM_CPU_FLOOR_MS = 30;
export const STREAM_FRAMES_FLOOR = 2;
export const STREAM_BYTES_FLOOR = 2048;

export function streamMeasures(results: Series<StreamReading>): Measure[] {
  return [
    { label: 'stream cpu', series: seriesOf(results, 'cpuMs'), floor: STREAM_CPU_FLOOR_MS },
    { label: 'frames', series: seriesOf(results, 'frames'), floor: STREAM_FRAMES_FLOOR },
    { label: 'bytes', series: seriesOf(results, 'bytes'), floor: STREAM_BYTES_FLOOR },
  ];
}

export function failOnStreamRegressions(results: Series<StreamReading>): void {
  failOnRegressions(streamMeasures(results));
}
