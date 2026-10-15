import { describe, expect, test } from 'bun:test';

import { fisherTwoSided, wilson } from '../compaction-stats.ts';

describe('wilson gives the 95% interval for a share', () => {
  test('3 of 40 matches the textbook interval', () => {
    const { low, high } = wilson(3, 40);
    expect(low).toBeCloseTo(0.0257, 3);
    expect(high).toBeCloseTo(0.1988, 3);
  });

  test('0 of 10 starts at zero and still allows some risk', () => {
    const { low, high } = wilson(0, 10);
    expect(low).toBe(0);
    expect(high).toBeCloseTo(0.2775, 3);
  });

  test('10 of 10 ends at one', () => {
    const { low, high } = wilson(10, 10);
    expect(low).toBeCloseTo(0.7225, 3);
    expect(high).toBe(1);
  });

  test('no replies means no information', () => {
    expect(wilson(0, 0)).toEqual({ low: 0, high: 1 });
  });
});

describe('fisherTwoSided tests two refusal counts against each other', () => {
  test('the tea-tasting table gives 0.4857', () => {
    expect(fisherTwoSided({ hits: 3, misses: 1 }, { hits: 1, misses: 3 })).toBeCloseTo(0.4857, 4);
  });

  test('a clear gap is far below 0.001', () => {
    expect(fisherTwoSided({ hits: 3, misses: 37 }, { hits: 21, misses: 19 })).toBeLessThan(0.001);
  });

  test('equal counts give a p-value of 1', () => {
    expect(fisherTwoSided({ hits: 5, misses: 15 }, { hits: 5, misses: 15 })).toBeCloseTo(1, 10);
  });

  test('a table with an empty row is still defined', () => {
    expect(fisherTwoSided({ hits: 0, misses: 10 }, { hits: 0, misses: 10 })).toBeCloseTo(1, 10);
    expect(fisherTwoSided({ hits: 0, misses: 10 }, { hits: 10, misses: 0 })).toBeCloseTo(
      1.08e-5,
      7,
    );
  });

  test('swapping the two arms does not change p', () => {
    expect(fisherTwoSided({ hits: 2, misses: 18 }, { hits: 9, misses: 11 })).toBeCloseTo(
      fisherTwoSided({ hits: 9, misses: 11 }, { hits: 2, misses: 18 }),
      12,
    );
  });
});
