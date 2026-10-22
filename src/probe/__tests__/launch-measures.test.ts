import { describe, expect, test } from 'bun:test';

import type { Series } from '../ab.ts';
import type { LaunchResult } from '../launch.ts';
import { regressionsOf } from '../regressions.ts';
import { launchMeasures } from '../speed-report.ts';

function runs(paint: readonly number[], quit: readonly number[]): LaunchResult[] {
  return paint.map((paintMs, index) => ({ paintMs, exitMs: quit[index] ?? 0, pid: 1 }));
}

const STEADY = [100, 104, 98, 102, 101, 99];

function pair(stock: LaunchResult[], patched: LaunchResult[]): Series<LaunchResult> {
  return [
    ['stock', stock],
    ['patched', patched],
  ];
}

describe('launchMeasures', () => {
  test('pairs paint and quit as two measures, in that order', () => {
    const measures = launchMeasures(pair(runs([1, 2], [30, 40]), runs([3, 4], [50, 60])));
    expect(measures.map((measure) => measure.label)).toEqual(['paint', 'quit']);
    expect(measures[0]?.series).toEqual([
      ['stock', [1, 2]],
      ['patched', [3, 4]],
    ]);
    expect(measures[1]?.series).toEqual([
      ['stock', [30, 40]],
      ['patched', [50, 60]],
    ]);
  });

  test('flags a slower quit alone, tested at the two-measure confidence', () => {
    const slowQuit = STEADY.map((value) => value + 80);
    const measures = launchMeasures(pair(runs(STEADY, STEADY), runs(STEADY, slowQuit)));
    const found = regressionsOf(measures);
    expect(found.map((regression) => regression.label)).toEqual(['quit']);
    expect(found[0]?.tests).toBe(2);
  });

  test('flags nothing when the patched build quits as fast', () => {
    expect(regressionsOf(launchMeasures(pair(runs(STEADY, STEADY), runs(STEADY, STEADY))))).toEqual(
      [],
    );
  });
});
