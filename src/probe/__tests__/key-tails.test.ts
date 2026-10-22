import { describe, expect, test } from 'bun:test';

import type { Press, PressKey, TailRun } from '../key-tails.ts';
import {
  describeTails,
  tailsOf,
  windowVerdict,
  worstBurstMs,
  worstSingleMs,
} from '../key-tails.ts';

function press(key: PressKey, tailMs: number, sentAt = 1000): Press {
  return { key, sentAt, outputAt: [sentAt + 1, sentAt + tailMs] };
}

function run(tails: { echo: number[]; backspace: number[]; burst: number }): TailRun {
  return {
    presses: tails.echo.flatMap((echo, index) => [
      press('echo', echo),
      press('backspace', tails.backspace[index] ?? 0),
    ]),
    burst: { lastKeyAt: 5000, outputAt: [5000 + tails.burst / 2, 5000 + tails.burst] },
  };
}

describe('tailsOf', () => {
  test('measures from the keypress to the last output byte and skips the first echo and backspace', () => {
    const tails = tailsOf([run({ echo: [500, 3, 8], backspace: [600, 4, 9], burst: 40 })]);

    expect(tails.echoMs).toEqual([3, 8]);
    expect(tails.backspaceMs).toEqual([4, 9]);
    expect(tails.burstMs).toEqual([40]);
  });

  test('pools the presses of every run but keeps one burst per run', () => {
    const tails = tailsOf([
      run({ echo: [1, 2], backspace: [1, 3], burst: 10 }),
      run({ echo: [1, 5], backspace: [1, 7], burst: 55 }),
    ]);

    expect(tails.echoMs).toEqual([2, 5]);
    expect(tails.backspaceMs).toEqual([3, 7]);
    expect(tails.burstMs).toEqual([10, 55]);
  });

  test('counts a burst whose output ended before the last key as no tail', () => {
    const tails = tailsOf([{ presses: [], burst: { lastKeyAt: 5000, outputAt: [4990, 4999] } }]);

    expect(tails.burstMs).toEqual([0]);
  });

  test('fails on a press that produced no output', () => {
    const silent: TailRun = {
      presses: [press('echo', 1), press('backspace', 1), { key: 'echo', sentAt: 1, outputAt: [] }],
      burst: { lastKeyAt: 1, outputAt: [] },
    };

    expect(() => tailsOf([silent])).toThrow(
      'echo press produced no output, so it has no tail to measure',
    );
  });
});

describe('describeTails', () => {
  test('gives median, p95 and max for each key and the burst range', () => {
    const text = describeTails({
      echoMs: [3, 3, 9],
      backspaceMs: [4],
      burstMs: [2, 55],
    });

    expect(text).toBe(
      [
        '  echo        median 3ms  p95 8ms  max 9ms  (n=3)',
        '  backspace   median 4ms  p95 4ms  max 4ms  (n=1)',
        '  burst       last byte 2ms to 55ms after the last key (n=2)',
      ].join('\n'),
    );
  });
});

describe('windowVerdict', () => {
  const tails = { echoMs: [3, 9], backspaceMs: [7], burstMs: [10, 55] };

  test('finds the worst tail across binaries', () => {
    const slower = { echoMs: [20], backspaceMs: [1], burstMs: [30] };

    expect(worstSingleMs([tails, slower])).toBe(20);
    expect(worstBurstMs([tails, slower])).toBe(55);
  });

  test('says by how much the window clears each worst tail', () => {
    expect(windowVerdict(200, [tails])).toBe(
      'the 200ms quiet window sits above the worst tail by 145ms: 3.6x the worst tail (55ms) after a burst and 22.2x the worst tail (9ms) after a single key',
    );
  });

  test('says when a tail outlasts the window', () => {
    expect(windowVerdict(200, [{ ...tails, burstMs: [250] }])).toBe(
      "the 200ms quiet window does NOT clear the worst tail: a 250ms tail (after a burst) outlasts it by 50ms, so one key's output can be mistaken for the next key's echo",
    );
  });

  test('names a single key when it is the longest tail', () => {
    expect(windowVerdict(200, [{ echoMs: [300], backspaceMs: [1], burstMs: [10] }])).toContain(
      'a 300ms tail (after a single key)',
    );
  });
});
