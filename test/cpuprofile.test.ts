import { describe, expect, test } from 'bun:test';

import type { CpuProfile, SelfTimeReport } from '../src/cpuprofile.ts';
import { selfTimes } from '../src/cpuprofile.ts';

const nodes = [
  { id: 1, callFrame: { functionName: 'root', url: 'a.js', lineNumber: 0 }, children: [2] },
  {
    id: 2,
    callFrame: { functionName: 'render', url: 'react-reconciler.js', lineNumber: 4 },
    children: [3, 4],
  },
  { id: 3, callFrame: { functionName: 'work', url: 'b.js', lineNumber: 9 } },
  { id: 4, callFrame: { functionName: 'spike', url: 'c.js', lineNumber: 19 } },
];

const profile: CpuProfile = {
  nodes,
  samples: [4, 3, 3, 3, 3, 3, 1],
  timeDeltas: [5000, 1500, 1500, 1500, 1500, 1500, 200],
  startTime: 0,
  endTime: 12_700,
};

const outlier: CpuProfile = {
  nodes,
  samples: [4, 3, 3, 3, 3, 3, 1],
  timeDeltas: [500_000, 1500, 1500, 1500, 1500, 1500, 200],
  startTime: 0,
  endTime: 507_700,
};

const shifting: CpuProfile = {
  nodes,
  samples: [3, 3, 3, 4, 4, 4, 4],
  timeDeltas: [1000, 1000, 1000, 9, 9, 9, 9],
  startTime: 0,
  endTime: 3036,
};

const empty: CpuProfile = {
  nodes: [],
  samples: [],
  timeDeltas: [],
  startTime: 0,
  endTime: 0,
};

function numbersOf(report: SelfTimeReport): number[] {
  return [
    report.chargedMicros,
    report.rawMicros,
    report.sampleCount,
    report.periodMicros,
    ...report.entries.flatMap((entry) => [
      entry.micros,
      entry.rawMicros,
      entry.samples,
      entry.inflation,
    ]),
  ];
}

describe('selfTimes', () => {
  test('estimates a node cost from its sample count and the derived period', () => {
    const { entries } = selfTimes(profile, 10);
    const work = entries.find((entry) => entry.stack[0] === 'work@b.js:10');
    expect(work?.samples).toBe(5);
    expect(work?.micros).toBe(7500);
    expect(work?.rawMicros).toBe(7500);
    expect(work?.inflation).toBe(1);
  });

  test('ranks the many-sample node above the single enormous delta', () => {
    const [first, second] = selfTimes(outlier, 10).entries;
    expect(first?.stack[0]).toBe('work@b.js:10');
    expect(first?.samples).toBe(5);
    expect(second?.stack[0]).toBe('spike@c.js:20');
    expect(second?.samples).toBe(1);
  });

  test('flags the single-sample stall as inflated', () => {
    const spike = selfTimes(outlier, 10).entries.find(
      (entry) => entry.stack[0] === 'spike@c.js:20',
    );
    expect(spike?.rawMicros).toBe(500_000);
    expect(spike?.micros).toBe(1500);
    expect(spike?.inflation).toBeCloseTo(333.33, 1);
  });

  test('derives the period as the median of the included deltas', () => {
    expect(selfTimes(profile, 10).periodMicros).toBe(1500);
  });

  test('a huge outlier delta does not move the derived period', () => {
    expect(selfTimes(outlier, 10).periodMicros).toBe(1500);
  });

  test('charged micros are the sample count times the period', () => {
    const report = selfTimes(profile, 10);
    expect(report.sampleCount).toBe(7);
    expect(report.chargedMicros).toBe(report.sampleCount * report.periodMicros);
  });

  test('keeps the raw sum as a diagnostic', () => {
    expect(selfTimes(profile, 10).rawMicros).toBe(12_700);
  });

  test('stops charging once the cut is passed', () => {
    const report = selfTimes(profile, 10, 8000);
    const work = report.entries.find((entry) => entry.stack[0] === 'work@b.js:10');
    expect(work?.samples).toBe(2);
    expect(work?.micros).toBe(3000);
    expect(report.sampleCount).toBe(3);
    expect(report.rawMicros).toBe(8000);
    expect(report.chargedMicros).toBe(4500);
  });

  test('excludes the root sample that falls after the cut', () => {
    const { entries } = selfTimes(profile, 10, 8000);
    expect(entries.some((entry) => entry.stack[0] === 'root@a.js:1')).toBe(false);
  });

  test('derives the period from the included deltas only', () => {
    expect(selfTimes(shifting, 10).periodMicros).toBe(9);
    expect(selfTimes(shifting, 10, 3000).periodMicros).toBe(1000);
  });

  test('an empty profile yields zeroes rather than NaN', () => {
    const report = selfTimes(empty, 10);
    expect(report.entries).toHaveLength(0);
    expect(report.periodMicros).toBe(0);
    expect(report.chargedMicros).toBe(0);
    expect(numbersOf(report).every((value) => Number.isFinite(value))).toBe(true);
  });

  test('a fully cut profile yields zeroes rather than NaN', () => {
    const report = selfTimes(profile, 10, 0);
    expect(report.entries).toHaveLength(0);
    expect(report.sampleCount).toBe(0);
    expect(report.periodMicros).toBe(0);
    expect(numbersOf(report).every((value) => Number.isFinite(value))).toBe(true);
  });

  test('walks parents and drops framework frames', () => {
    const [first] = selfTimes(profile, 1).entries;
    expect(first?.stack).toEqual(['work@b.js:10', 'root@a.js:1']);
  });

  test('limits the result to the requested count', () => {
    expect(selfTimes(profile, 1).entries).toHaveLength(1);
  });
});
