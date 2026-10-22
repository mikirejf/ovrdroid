import { describe, expect, test } from 'bun:test';

import {
  interleave,
  interleaveWith,
  pairedStats,
  quantile,
  slowerWithConfidence,
  summarise,
} from '../ab.ts';

describe('interleave', () => {
  test('warms each binary once with the measurement itself', async () => {
    const calls: string[] = [];
    const series = await interleave(
      ['stock', 'patched'],
      async (binary) => {
        calls.push(binary);
        await Promise.resolve();
        return calls.length;
      },
      2,
    );
    expect(calls).toEqual(['stock', 'patched', 'stock', 'patched', 'patched', 'stock']);
    expect(series).toEqual([
      ['stock', [3, 6]],
      ['patched', [4, 5]],
    ]);
  });
});

describe('interleaveWith', () => {
  test('runs the given warm-up instead of a measurement and records nothing from it', async () => {
    const warmed: string[] = [];
    const measured: string[] = [];
    const series = await interleaveWith(
      ['stock', 'patched'],
      {
        measure: async (binary) => {
          measured.push(binary);
          await Promise.resolve();
          return measured.length;
        },
        warmUp: async (binary) => {
          warmed.push(binary);
          await Promise.resolve();
        },
      },
      2,
    );
    expect(warmed).toEqual(['stock', 'patched']);
    expect(measured).toEqual(['stock', 'patched', 'patched', 'stock']);
    expect(series).toEqual([
      ['stock', [1, 4]],
      ['patched', [2, 3]],
    ]);
  });
});

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

  test('fewer than two pairs never resolve, because there is no spread to bound', () => {
    expect(pairedStats([], []).margin).toBe(Number.POSITIVE_INFINITY);
    expect(pairedStats([100], [80]).margin).toBe(Number.POSITIVE_INFINITY);
  });

  test('small samples use Student t, so two pairs need a far wider margin than z gives', () => {
    const stats = pairedStats([100, 100], [86, 90]);
    expect(stats.margin).toBeCloseTo((12.706 * stats.sdDiff) / Math.sqrt(2), 6);
  });
});

describe('slowerWithConfidence', () => {
  test('a second series slower with a tight spread is slower with confidence', () => {
    expect(slowerWithConfidence([100, 102, 98, 101], [150, 149, 152, 151])).toBe(true);
  });

  test('a second series faster is not slower', () => {
    expect(slowerWithConfidence([150, 149, 152, 151], [100, 102, 98, 101])).toBe(false);
  });

  test('an interval that straddles zero passes, even with a slower mean', () => {
    const stats = pairedStats([100, 100, 100, 100], [60, 160, 90, 150]);
    expect(stats.meanDiff).toBeGreaterThan(0);
    expect(stats.meanDiff - stats.margin).toBeLessThan(0);
    expect(slowerWithConfidence([100, 100, 100, 100], [60, 160, 90, 150])).toBe(false);
  });

  test('identical series pass', () => {
    expect(slowerWithConfidence([100, 100, 100], [100, 100, 100])).toBe(false);
  });

  test('fewer than two pairs never resolve, so they pass', () => {
    expect(slowerWithConfidence([100], [900])).toBe(false);
    expect(slowerWithConfidence([], [])).toBe(false);
  });
});

describe('summarise', () => {
  test('reports the spread in one line', () => {
    expect(summarise([10, 20, 30, 40, 50])).toBe('min 10  p25 20  median 30  p75 40');
  });
});
