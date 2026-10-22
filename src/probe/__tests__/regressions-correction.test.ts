import { describe, expect, test } from 'bun:test';

import { pairedStats } from '../ab.ts';
import type { Measure } from '../regressions.ts';
import {
  confidenceFor,
  correctedMargin,
  describeRegression,
  regressionsOf,
  tCritical,
} from '../regressions.ts';

const STEADY = [100, 102, 98, 101];
const SLOWER = [150, 149, 152, 151];
const LABELS = ['a', 'b', 'c', 'd', 'e'];

function measureOf(label: string, stock: number[], patched: number[]): Measure {
  return {
    label,
    floor: 0,
    series: [
      ['stock', stock],
      ['patched', patched],
    ],
  };
}

function failing(count: number, stock: number[], patched: number[]): string[] {
  return regressionsOf(LABELS.slice(0, count).map((label) => measureOf(label, stock, patched))).map(
    ({ label }) => label,
  );
}

describe('tCritical', () => {
  test.each([
    [1, 0.95, 12.706],
    [2, 0.95, 4.303],
    [3, 0.95, 3.182],
    [4, 0.95, 2.776],
    [9, 0.95, 2.262],
    [30, 0.95, 2.042],
    [2, 0.99, 9.925],
    [3, 0.99, 5.841],
    [4, 0.99, 4.604],
    [9, 0.99, 3.25],
    [30, 0.99, 2.75],
  ])('df %d at %d confidence matches the Student t table', (df, confidence, expected) => {
    expect(tCritical(df, confidence)).toBeCloseTo(expected, 2);
  });
});

describe('Bonferroni correction', () => {
  const stock = [100, 100, 100, 100];
  const creeping = [104, 108, 112, 116];
  const stats = pairedStats(stock, creeping);

  test('confidenceFor splits the 5% across the measures', () => {
    expect(confidenceFor(1)).toBeCloseTo(0.95, 10);
    expect(confidenceFor(5)).toBeCloseTo(0.99, 10);
  });

  test('one measure keeps the 95% margin of pairedStats', () => {
    expect(correctedMargin(stats, 1)).toBeCloseTo(stats.margin, 1);
    const wide = pairedStats([100, 120, 90, 110, 95, 105], [101, 119, 95, 108, 99, 100]);
    expect(correctedMargin(wide, 1)).toBeCloseTo(wide.margin, 1);
  });

  test('more measures widen the margin', () => {
    expect(correctedMargin(stats, 2)).toBeGreaterThan(correctedMargin(stats, 1));
    expect(correctedMargin(stats, 5)).toBeGreaterThan(correctedMargin(stats, 2));
  });

  test('fewer than two rounds have no margin', () => {
    expect(correctedMargin(pairedStats([100], [900]), 1)).toBe(Number.POSITIVE_INFINITY);
  });

  test('a series that fails at 95% alone passes once two measures share the 5%', () => {
    expect(failing(1, stock, creeping)).toEqual(['a']);
    expect(failing(2, stock, creeping)).toEqual([]);
  });

  test('and still passes with five measures', () => {
    expect(failing(5, stock, creeping)).toEqual([]);
  });

  test('a large effect survives the correction', () => {
    expect(failing(5, STEADY, SLOWER)).toEqual(LABELS);
  });

  test('the corrected interval is the one the verdict used', () => {
    const [found] = regressionsOf([measureOf('a', STEADY, SLOWER), measureOf('b', STEADY, SLOWER)]);
    expect(found?.tests).toBe(2);
    expect(found?.confidence).toBeCloseTo(0.975, 10);
    expect(found?.margin).toBeCloseTo(correctedMargin(pairedStats(STEADY, SLOWER), 2), 10);
  });
});

describe('describeRegression states which interval decided', () => {
  test('one measure is the plain 95% interval', () => {
    const [text = ''] = regressionsOf([measureOf('echo', STEADY, SLOWER)]).map((found) =>
      describeRegression(found),
    );
    expect(text).toStartWith(
      'REGRESSION echo: patched is worse than stock by 50.3 (95% CI 45.7 to 54.8',
    );
    expect(text).toEndWith(
      ', n=4; verdict interval, one measure), and its lower bound clears the floor of 0',
    );
  });

  test('several measures name the corrected confidence and the count', () => {
    const [text = ''] = regressionsOf(
      LABELS.slice(0, 4).map((l) => measureOf(l, STEADY, SLOWER)),
    ).map((found) => describeRegression(found));
    expect(text).toContain('REGRESSION a: patched is worse than stock');
    expect(text).toContain('98.75% CI');
    expect(text).toContain('Bonferroni over 4 measures: each tested at 1 - 0.05/4');
  });
});
