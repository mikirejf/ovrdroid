import { describe, expect, test } from 'bun:test';

import { describeClear, readClear } from '../clear.ts';
import { flatBox, frame, stockBox } from './screens.ts';

const TYPED = 'hello next';

describe('readClear', () => {
  test('stock: typed text shows during the switch, then the finished switch wipes it', () => {
    const reading = readClear(
      [
        frame(12, `⠋ Starting new session...\n${stockBox('')}`),
        frame(600, `⠇ Starting new session...\n${stockBox(TYPED)}`),
        frame(2045, `⣠ Starting new session...\n${stockBox(TYPED)}`),
        frame(2102, `● ✓ New session created\n${stockBox(TYPED)}`),
        frame(2112, stockBox('')),
      ],
      TYPED,
    );

    expect(reading).toEqual({ busyMs: 2045, readyMs: 2102, input: '', kept: false });
    expect(describeClear(reading)).toContain('was lost');
  });

  test('patched: the switch finishes first and the typed text stays', () => {
    const reading = readClear(
      [
        frame(13, `⠋ Starting new session...\n${stockBox('')}`),
        frame(26, `● ✓ New session created\n${stockBox('')}`),
        frame(600, stockBox(TYPED)),
      ],
      TYPED,
    );

    expect(reading).toEqual({ busyMs: 13, readyMs: 26, input: TYPED, kept: true });
    expect(describeClear(reading)).toContain('was kept');
  });

  test('patched box: the typed text is read from a box with no side glyphs', () => {
    const reading = readClear(
      [
        frame(13, `⠋ Starting new session...\n${flatBox('')}`),
        frame(26, `● ✓ New session created\n${flatBox('')}`),
        frame(600, flatBox(TYPED)),
      ],
      TYPED,
    );

    expect(reading).toEqual({ busyMs: 13, readyMs: 26, input: TYPED, kept: true });
  });

  test('patched box: a wiped draft reads as empty and is lost', () => {
    const reading = readClear(
      [frame(26, `● ✓ New session created\n${flatBox(TYPED)}`), frame(40, flatBox(''))],
      TYPED,
    );

    expect(reading.input).toBe('');
    expect(reading.kept).toBe(false);
  });

  test('frames without an input box do not reset what was last seen in it', () => {
    const reading = readClear([frame(5, stockBox(TYPED)), frame(9, 'status line only')], TYPED);

    expect(reading.input).toBe(TYPED);
    expect(reading.readyMs).toBeUndefined();
  });
});
