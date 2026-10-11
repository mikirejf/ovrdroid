import { describe, expect, test } from 'bun:test';

import type { LagRow } from '../lag.ts';
import { formatLagPhases, readLagPhases } from '../subagents-lag.ts';

const SEND = 40_000;
const DONE = 100_000;

function row(t: number, p99: number, extra: { max?: number; busy?: number } = {}): LagRow {
  return { t, pid: 1, n: 20, p50: 1, p99, max: extra.max ?? p99, busy: extra.busy ?? 0 };
}

function secondsOf(from: number, to: number, make: (t: number) => LagRow): LagRow[] {
  const rows: LagRow[] = [];
  for (let t = from; t < to; t += 1000) {
    rows.push(make(t));
  }
  return rows;
}

const timeline = {
  sendMs: SEND,
  doneMs: DONE,
  running: { fromMs: SEND, toMs: DONE },
  excluded: [{ fromMs: 20_000, toMs: 26_000 }],
};

const rows = [
  ...secondsOf(0, SEND, (t) => row(t, 2, { max: 4, busy: 0 })),
  ...secondsOf(SEND, DONE, (t) => row(t, 30, { max: t === 70_000 ? 900 : 60, busy: 0.4 })),
  ...secondsOf(DONE, DONE + 40_000, (t) => row(t, 3, { max: 5, busy: 0.01 })),
];

describe('readLagPhases compares the loop before, during and after', () => {
  const phases = readLagPhases(rows, timeline);

  test('the baseline is the ten seconds before sending', () => {
    expect(phases.baseline?.rows).toBe(10);
    expect(phases.baseline?.medianP99).toBe(2);
    expect(phases.baseline?.worstMax).toBe(4);
  });

  test('while running covers send to done and keeps the worst second', () => {
    expect(phases.running?.rows).toBe(60);
    expect(phases.running?.medianP99).toBe(30);
    expect(phases.running?.worstMax).toBe(900);
    expect(phases.running?.meanBusy).toBeCloseTo(0.4, 5);
  });

  test('after is read well past the final reply', () => {
    expect(phases.after?.rows).toBe(10);
    expect(phases.after?.medianP99).toBe(3);
    expect(phases.after?.meanBusy).toBeCloseTo(0.01, 5);
  });
});

describe('a heap snapshot window is left out', () => {
  const stopped = [...rows, row(25_000, 9000, { max: 9000, busy: 1 }), row(41_000, 2)];
  const timelineWithSnapshot = {
    ...timeline,
    sendMs: 28_000,
    running: { fromMs: 28_000, toMs: DONE },
  };

  test('the second the snapshot stopped the loop in is not the worst max', () => {
    const phases = readLagPhases(stopped, timelineWithSnapshot);
    expect(phases.baseline?.worstMax).toBe(4);
    expect(phases.baseline?.rows).toBeLessThan(3);
  });
});

describe('missing rows are said so', () => {
  test('a phase without rows is not measured', () => {
    const phases = readLagPhases(
      secondsOf(0, SEND, (t) => row(t, 2)),
      timeline,
    );
    expect(phases.running).toBeUndefined();
    expect(phases.after).toBeUndefined();
    expect(formatLagPhases(phases)).toContain('after they finished  not measured');
  });

  test('the words label the three phases', () => {
    const text = formatLagPhases(readLagPhases(rows, timeline));
    expect(text).toContain('event-loop lag of the parent process');
    expect(text).toContain('before sending');
    expect(text).toContain('while running');
    expect(text).toContain('median p99 30.0ms, worst max 900.0ms, mean busy 40.0% (60 rows)');
  });
});
