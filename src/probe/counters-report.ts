import { say } from '../cli.ts';
import type { Series } from './ab.ts';
import { pairedStats, quantile } from './ab.ts';
import type { Counted } from './counter-file.ts';
import type { CounterWindow } from './counters.ts';
import { summariseWindow } from './counters.ts';

const MEDIAN = 0.5;

const VERDICT_METRICS: readonly (readonly [keyof CounterWindow, string])[] = [
  ['commit', 'commits'],
  ['build', 'frames built'],
  ['frameMs', 'ms building frames'],
  ['root', 'root renders'],
  ['list', 'message list renders'],
  ['md', 'markdown parses'],
];

export function medianWindow(windows: readonly CounterWindow[]): CounterWindow {
  const median = (pick: (window: CounterWindow) => number) =>
    quantile(
      windows.map((window) => pick(window)),
      MEDIAN,
    );
  return {
    commit: median((window) => window.commit),
    build: median((window) => window.build),
    frame: median((window) => window.frame),
    frameMs: median((window) => window.frameMs),
    root: median((window) => window.root),
    list: median((window) => window.list),
    md: median((window) => window.md),
    bytes: median((window) => window.bytes),
    spanMs: median((window) => window.spanMs),
    cpuMs: median((window) => window.cpuMs),
  };
}

export function countVerdict(results: Series<number>, metric: string): string {
  const [first, second] = results;
  if (first === undefined || second === undefined || results.length !== 2) {
    throw new Error('a paired verdict needs exactly two binaries');
  }
  const stats = pairedStats(first[1], second[1]);
  const low = stats.meanDiff - stats.margin;
  const high = stats.meanDiff + stats.margin;
  const head = `paired ${metric} (${second[0]} minus ${first[0]}, n=${stats.n}): mean ${stats.meanDiff.toFixed(1)}`;
  if (stats.n < 2) {
    return `${head}; one round is one sample, not a result`;
  }
  const interval = `${head}, 95% CI ${low.toFixed(1)} to ${high.toFixed(1)}`;
  if (low <= 0 && high >= 0) {
    return `${interval}; not resolved, the interval contains zero`;
  }
  const lower = stats.meanDiff < 0 ? second[0] : first[0];
  return `${interval}; ${lower} is lower by ${Math.abs(stats.meanDiff).toFixed(1)}`;
}

function windowNames(runs: readonly Counted[]): string[] {
  return Object.keys(runs.find((run) => run.counters !== undefined)?.counters ?? {});
}

function allCounted(runs: readonly Counted[]): boolean {
  return runs.length > 0 && runs.every((run) => run.counters !== undefined);
}

function pickWindows(runs: readonly Counted[], name: string): CounterWindow[] {
  return runs.flatMap((run) => {
    const window = run.counters?.[name];
    return window === undefined ? [] : [window];
  });
}

function verdictLines(results: Series<Counted>): string[] {
  const names = windowNames(results.flatMap(([, runs]) => runs));
  return names.flatMap((name) =>
    VERDICT_METRICS.map(([metric, label]) =>
      countVerdict(
        results.map(([binary, runs]) => [
          binary,
          pickWindows(runs, name).map((window) => window[metric]),
        ]),
        `${name} ${label}`,
      ),
    ),
  );
}

export function formatCounters(results: Series<Counted>): string[] {
  const counted = results.filter(([, runs]) => runs.some((run) => run.counters !== undefined));
  if (counted.length === 0) {
    return [];
  }
  const lines = ['', 'render counters, median over the runs, deltas inside each measured window'];
  for (const [binary, runs] of counted) {
    lines.push('', binary);
    for (const name of windowNames(runs)) {
      lines.push(`  ${name.padEnd(8)}${summariseWindow(medianWindow(pickWindows(runs, name)))}`);
    }
  }
  if (results.length === 2 && results.every(([, runs]) => allCounted(runs))) {
    lines.push('', ...verdictLines(results));
  }
  return lines;
}

export function sayCounters(results: Series<Counted>): void {
  for (const line of formatCounters(results)) {
    say(line);
  }
}
