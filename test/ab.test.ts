import { describe, expect, test } from 'bun:test';

import { pairedStats, quantile, summarise } from '../src/ab.ts';

describe('quantile', () => {
  test('sorts before picking, so call order does not matter', () => {
    expect(quantile([30, 10, 20], 0.5)).toBe(20);
  });

  test('interpolates between the two neighbours', () => {
    expect(quantile([10, 20], 0.5)).toBe(15);
  });

  test('returns the extremes at zero and one', () => {
    expect(quantile([5, 1, 9], 0)).toBe(1);
    expect(quantile([5, 1, 9], 1)).toBe(9);
  });

  test('an empty series yields zero rather than NaN', () => {
    expect(quantile([], 0.5)).toBe(0);
  });
});

describe('pairedStats', () => {
  test('measures the second series minus the first', () => {
    const stats = pairedStats([100, 100, 100], [90, 90, 90]);
    expect(stats.n).toBe(3);
    expect(stats.meanDiff).toBe(-10);
    expect(stats.sdDiff).toBe(0);
    expect(stats.margin).toBe(0);
  });

  test('a single pair has no spread to report', () => {
    const stats = pairedStats([100], [80]);
    expect(stats.n).toBe(1);
    expect(stats.meanDiff).toBe(-20);
    expect(stats.sdDiff).toBe(0);
  });

  test('widens the margin as the differences scatter', () => {
    const tight = pairedStats([100, 100, 100, 100], [95, 96, 94, 95]);
    const loose = pairedStats([100, 100, 100, 100], [60, 130, 80, 110]);
    expect(loose.margin).toBeGreaterThan(tight.margin);
  });

  test('empty series yield zeroes rather than NaN', () => {
    const stats = pairedStats([], []);
    expect([stats.n, stats.meanDiff, stats.sdDiff, stats.margin]).toEqual([0, 0, 0, 0]);
  });
});

describe('summarise', () => {
  test('reports the spread in one line', () => {
    expect(summarise([10, 20, 30, 40, 50])).toBe('min 10  p25 20  median 30  p75 40');
  });
});
