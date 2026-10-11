import { MS_PER_SECOND } from '../cli.ts';

export interface Point {
  t: number;
  value: number;
}

export interface Span {
  fromMs: number;
  toMs: number;
}

export interface Reading {
  baseline: number;
  peak: number;
  peakT: number;
  end: number;
}

export interface ReadingView {
  startT: number;
  text: (value: number) => string;
}

const RISE_RATIO = 1.05;
const GUARD_BEFORE_MS = 500;
const GUARD_AFTER_MS = 3000;

export function sumOf(values: readonly number[]): number {
  let total = 0;
  for (const value of values) {
    total += value;
  }
  return total;
}

export function maxOf(values: readonly number[]): number {
  let top = 0;
  for (const value of values) {
    top = Math.max(top, value);
  }
  return top;
}

export function meanOf(values: readonly number[]): number | undefined {
  return values.length === 0 ? undefined : sumOf(values) / values.length;
}

export function median(values: readonly number[]): number | undefined {
  const ordered = values.toSorted((a, b) => a - b);
  const middle = Math.floor(ordered.length / 2);
  if (ordered.length === 0) {
    return undefined;
  }
  return ordered.length % 2 === 1
    ? ordered[middle]
    : ((ordered[middle - 1] ?? 0) + (ordered[middle] ?? 0)) / 2;
}

export function isExcluded(atMs: number, excluded: readonly Span[]): boolean {
  return excluded.some(
    (window) => atMs >= window.fromMs - GUARD_BEFORE_MS && atMs <= window.toMs + GUARD_AFTER_MS,
  );
}

export function readSeries(points: readonly Point[], baselineMs: number): Reading | undefined {
  const start = points.at(0);
  const end = points.at(-1);
  if (start === undefined || end === undefined) {
    return undefined;
  }

  const early = points.filter((point) => point.t - start.t <= baselineMs);
  const baseline = sumOf(early.map((point) => point.value)) / early.length;
  let peak = start;
  for (const point of points) {
    if (point.value > peak.value) {
      peak = point;
    }
  }
  return { baseline, peak: peak.value, peakT: peak.t, end: end.value };
}

export function describeReading(label: string, reading: Reading, view: ReadingView): string {
  const { startT, text } = view;
  const peakAt = ((reading.peakT - startT) / MS_PER_SECOND).toFixed(1);
  if (reading.peak > reading.baseline * RISE_RATIO) {
    return `${label}: rose ${text(reading.baseline)} -> ${text(reading.peak)} peak (at +${peakAt}s), settled ${text(reading.end)}`;
  }
  if (reading.end * RISE_RATIO < reading.baseline) {
    return `${label}: fell ${text(reading.baseline)} -> ${text(reading.end)}, never above ${text(reading.peak)}`;
  }
  return `${label}: stayed near ${text(reading.baseline)}, peak ${text(reading.peak)}, settled ${text(reading.end)}`;
}
