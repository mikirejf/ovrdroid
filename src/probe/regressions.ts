import type { PairedStats, Series } from './ab.ts';
import { pairedStats } from './ab.ts';

export interface Measure {
  label: string;
  series: Series<number>;
  floor: number;
}

export interface Regression {
  label: string;
  stock: string;
  patched: string;
  n: number;
  meanDiff: number;
  margin: number;
  floor: number;
  confidence: number;
  tests: number;
}

const FAMILY_ALPHA = 0.05;
const PERCENT = 100;
const SEARCH_LIMIT = 1e6;
const SEARCH_STEPS = 200;

export function confidenceFor(tests: number): number {
  return 1 - FAMILY_ALPHA / tests;
}

function centralMass(t: number, df: number): number {
  const theta = Math.atan(t / Math.sqrt(df));
  if (df === 1) {
    return (2 / Math.PI) * theta;
  }
  const cos = Math.cos(theta);
  const cosSquared = cos * cos;
  const even = df % 2 === 0;
  let term = even ? 1 : cos;
  let sum = term;
  for (let step = 1; step < (even ? df / 2 : (df - 1) / 2); step++) {
    term *= ((even ? 2 * step - 1 : 2 * step) / (even ? 2 * step : 2 * step + 1)) * cosSquared;
    sum += term;
  }
  return even ? Math.sin(theta) * sum : (2 / Math.PI) * (theta + Math.sin(theta) * sum);
}

export function tCritical(df: number, confidence: number): number {
  let low = 0;
  let high = SEARCH_LIMIT;
  for (let step = 0; step < SEARCH_STEPS; step++) {
    const middle = (low + high) / 2;
    if (centralMass(middle, df) < confidence) {
      low = middle;
    } else {
      high = middle;
    }
  }
  return (low + high) / 2;
}

export function correctedMargin(stats: PairedStats, tests: number): number {
  if (stats.n < 2) {
    return Number.POSITIVE_INFINITY;
  }
  return (tCritical(stats.n - 1, confidenceFor(tests)) * stats.sdDiff) / Math.sqrt(stats.n);
}

export function resolvedWorseOf(measures: readonly Measure[]): Regression[] {
  const tests = measures.length;
  return measures.flatMap(({ label, series, floor }) => {
    const [first, second] = series;
    if (series.length !== 2 || first === undefined || second === undefined) {
      return [];
    }
    const stats = pairedStats(first[1], second[1]);
    const margin = correctedMargin(stats, tests);
    if (stats.meanDiff - margin <= 0) {
      return [];
    }
    return [
      {
        label,
        stock: first[0],
        patched: second[0],
        n: stats.n,
        meanDiff: stats.meanDiff,
        margin,
        floor,
        confidence: confidenceFor(tests),
        tests,
      },
    ];
  });
}

function exceedsFloor(regression: Regression): boolean {
  return regression.meanDiff - regression.margin > regression.floor;
}

export function regressionsOf(measures: readonly Measure[]): Regression[] {
  return resolvedWorseOf(measures).filter((regression) => exceedsFloor(regression));
}

function percent(confidence: number): string {
  return String(Number((confidence * PERCENT).toFixed(2)));
}

export function describeRegression(regression: Regression): string {
  const { label, stock, patched, n, meanDiff, margin, floor, confidence, tests } = regression;
  const interval = `${percent(confidence)}% CI ${(meanDiff - margin).toFixed(1)} to ${(meanDiff + margin).toFixed(1)}`;
  const basis =
    tests === 1
      ? 'one measure'
      : `Bonferroni over ${tests} measures: each tested at 1 - 0.05/${tests}`;
  const evidence = `(${interval}, n=${n}; verdict interval, ${basis})`;
  if (!exceedsFloor(regression)) {
    return `within floor ${label}: ${patched} is worse than ${stock} by ${meanDiff.toFixed(1)} ${evidence}, but the interval does not clear the floor of ${floor}, so it passes`;
  }
  return `REGRESSION ${label}: ${patched} is worse than ${stock} by ${meanDiff.toFixed(1)} ${evidence}, and its lower bound clears the floor of ${floor}`;
}

export function failOnRegressions(measures: readonly Measure[]): void {
  for (const regression of resolvedWorseOf(measures)) {
    process.stderr.write(`${describeRegression(regression)}\n`);
    if (exceedsFloor(regression)) {
      process.exitCode = 1;
    }
  }
}
