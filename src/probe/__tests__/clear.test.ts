import { describe, expect, test } from 'bun:test';

import { describeClear, readClear } from '../clear.ts';
import type { Frame } from '../session.ts';

const TYPED = 'hello next';

function box(input: string): string {
  return `╭────╮\n│ > ${input}   │\n╰────╯`;
}

function frame(atMs: number, text: string): Frame {
  return { atMs, text };
}

describe('readClear', () => {
  test('stock: typed text shows during the switch, then the finished switch wipes it', () => {
    const reading = readClear(
      [
        frame(12, `⠋ Starting new session...\n${box('')}`),
        frame(600, `⠇ Starting new session...\n${box(TYPED)}`),
        frame(2045, `⣠ Starting new session...\n${box(TYPED)}`),
        frame(2102, `● ✓ New session created\n${box(TYPED)}`),
        frame(2112, box('')),
      ],
      TYPED,
    );

    expect(reading).toEqual({ busyMs: 2045, readyMs: 2102, input: '', kept: false });
    expect(describeClear(reading)).toContain('was lost');
  });

  test('patched: the switch finishes first and the typed text stays', () => {
    const reading = readClear(
      [
        frame(13, `⠋ Starting new session...\n${box('')}`),
        frame(26, `● ✓ New session created\n${box('')}`),
        frame(600, box(TYPED)),
      ],
      TYPED,
    );

    expect(reading).toEqual({ busyMs: 13, readyMs: 26, input: TYPED, kept: true });
    expect(describeClear(reading)).toContain('was kept');
  });

  test('frames without an input box do not reset what was last seen in it', () => {
    const reading = readClear([frame(5, box(TYPED)), frame(9, 'status line only')], TYPED);

    expect(reading.input).toBe(TYPED);
    expect(reading.readyMs).toBeUndefined();
  });
});
