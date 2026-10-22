import { quantile } from './ab.ts';

const MEDIAN = 0.5;
const P95 = 0.95;
const SKIPPED_TRIALS = 1;

export type PressKey = 'echo' | 'backspace';

export interface Press {
  key: PressKey;
  sentAt: number;
  outputAt: readonly number[];
}

export interface BurstRecord {
  lastKeyAt: number;
  outputAt: readonly number[];
}

export interface TailRun {
  presses: readonly Press[];
  burst: BurstRecord;
}

export interface Tails {
  echoMs: number[];
  backspaceMs: number[];
  burstMs: number[];
}

function tailOf(sentAt: number, outputAt: readonly number[]): number {
  return Math.max(0, (outputAt.at(-1) ?? sentAt) - sentAt);
}

function skipFirstTrial(presses: readonly Press[]): readonly Press[] {
  return presses.slice(SKIPPED_TRIALS * 2);
}

function pressTails(presses: readonly Press[], key: PressKey): number[] {
  return skipFirstTrial(presses)
    .filter((press) => press.key === key)
    .map((press) => {
      if (press.outputAt.length === 0) {
        throw new Error(`${key} press produced no output, so it has no tail to measure`);
      }
      return tailOf(press.sentAt, press.outputAt);
    });
}

export function tailsOf(runs: readonly TailRun[]): Tails {
  return {
    echoMs: runs.flatMap((run) => pressTails(run.presses, 'echo')),
    backspaceMs: runs.flatMap((run) => pressTails(run.presses, 'backspace')),
    burstMs: runs.map((run) => tailOf(run.burst.lastKeyAt, run.burst.outputAt)),
  };
}

function ms(value: number): string {
  return `${value.toFixed(0)}ms`;
}

function pressRow(label: string, values: readonly number[]): string {
  return [
    `  ${label.padEnd(10)}`,
    `median ${ms(quantile(values, MEDIAN))}`,
    `p95 ${ms(quantile(values, P95))}`,
    `max ${ms(Math.max(...values))}`,
    `(n=${values.length})`,
  ].join('  ');
}

export function describeTails(tails: Tails): string {
  return [
    pressRow('echo', tails.echoMs),
    pressRow('backspace', tails.backspaceMs),
    `  burst       last byte ${ms(Math.min(...tails.burstMs))} to ${ms(Math.max(...tails.burstMs))} after the last key (n=${tails.burstMs.length})`,
  ].join('\n');
}

export function worstSingleMs(all: readonly Tails[]): number {
  return Math.max(...all.flatMap((tails) => [...tails.echoMs, ...tails.backspaceMs]));
}

export function worstBurstMs(all: readonly Tails[]): number {
  return Math.max(...all.flatMap((tails) => tails.burstMs));
}

function margin(quietMs: number, worstMs: number): string {
  return worstMs === 0
    ? `above the worst tail (${ms(worstMs)})`
    : `${(quietMs / worstMs).toFixed(1)}x the worst tail (${ms(worstMs)})`;
}

export function windowVerdict(quietMs: number, all: readonly Tails[]): string {
  const single = worstSingleMs(all);
  const burst = worstBurstMs(all);
  const worst = Math.max(single, burst);
  const window = `the ${ms(quietMs)} quiet window`;
  if (quietMs > worst) {
    return `${window} sits above the worst tail by ${ms(quietMs - worst)}: ${margin(quietMs, burst)} after a burst and ${margin(quietMs, single)} after a single key`;
  }
  return `${window} does NOT clear the worst tail: a ${ms(worst)} tail (${worst === burst ? 'after a burst' : 'after a single key'}) outlasts it by ${ms(worst - quietMs)}, so one key's output can be mistaken for the next key's echo`;
}
