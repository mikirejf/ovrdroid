import type { Series } from './ab.ts';
import { quantile } from './ab.ts';

export const MISSED = 'missed';
export const ECHO_TIMEOUT_MS = 2000;
export const MARKERS = 'жщфыэюя';

const MEDIAN = 0.5;
const P95 = 0.95;

export interface Chunk {
  atMs: number;
  text: string;
}

export interface Trial {
  marker: string;
  sentAt: number;
}

export type Echo = number | typeof MISSED;

export interface EchoSummary {
  echoed: number;
  missed: number;
  medianMs?: number;
  p95Ms?: number;
  maxMs?: number;
}

export function markerAt(index: number): string {
  return MARKERS[index % MARKERS.length] ?? MARKERS.charAt(0);
}

export function echoOf(chunks: readonly Chunk[], trial: Trial, timeoutMs: number): Echo {
  const shown = chunks.find(
    (chunk) =>
      chunk.atMs >= trial.sentAt &&
      chunk.atMs - trial.sentAt <= timeoutMs &&
      chunk.text.includes(trial.marker),
  );
  return shown === undefined ? MISSED : shown.atMs - trial.sentAt;
}

export function readEchoes(
  chunks: readonly Chunk[],
  trials: readonly Trial[],
  timeoutMs: number,
): Echo[] {
  return trials.map((trial) => echoOf(chunks, trial, timeoutMs));
}

function echoedMs(echoes: readonly Echo[]): number[] {
  return echoes.filter((echo) => echo !== MISSED);
}

export function summariseEchoes(runs: readonly (readonly Echo[])[]): EchoSummary {
  const all = runs.flat();
  const times = echoedMs(all);
  const missed = all.length - times.length;
  if (times.length === 0) {
    return { echoed: 0, missed };
  }
  return {
    echoed: times.length,
    missed,
    medianMs: quantile(times, MEDIAN),
    p95Ms: quantile(times, P95),
    maxMs: Math.max(...times),
  };
}

export function runMedian(echoes: readonly Echo[]): number | undefined {
  const times = echoedMs(echoes);
  return times.length === 0 ? undefined : quantile(times, MEDIAN);
}

export function pairedMedians(series: Series<Echo[]>): Series<number> {
  const medians = series.map(
    ([binary, runs]) => [binary, runs.map((run) => runMedian(run))] as const,
  );
  const rounds = Math.min(...medians.map(([, values]) => values.length));
  const complete = Array.from({ length: rounds }, (_, round) => round).filter((round) =>
    medians.every(([, values]) => values[round] !== undefined),
  );
  return medians.map(([binary, values]) => [
    binary,
    complete.map((round) => values[round] ?? Number.NaN),
  ]);
}

function ms(value: number | undefined): string {
  return value === undefined ? 'n/a' : `${value.toFixed(0)}ms`;
}

export function formatSummary(binary: string, summary: EchoSummary): string {
  const missed =
    summary.missed === 0
      ? 'none missed'
      : `${summary.missed} missed (no echo within ${ECHO_TIMEOUT_MS}ms)`;
  return [
    `  ${binary}`,
    `    ${summary.echoed} keys echoed: median ${ms(summary.medianMs)}, p95 ${ms(summary.p95Ms)}, max ${ms(summary.maxMs)}; ${missed}`,
  ].join('\n');
}
