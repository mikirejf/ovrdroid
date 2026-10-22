import { describe, expect, test } from 'bun:test';

import { paintDetector } from '../launch.ts';

const SYNC_START = '\u001B[?2026h';
const SYNC_END = '\u001B[?2026l';
const SHELL = 'logo\ntip\n╭────╮\n│ > │\n╰────╯';

function feed(...chunks: string[]): boolean[] {
  const isPainted = paintDetector();
  return chunks.map((chunk) => isPainted(chunk));
}

describe('paintDetector', () => {
  test('never counts the early shell, which has a box but no synchronized output', () => {
    expect(feed(SHELL, SHELL, 'more')).toEqual([false, false, false]);
  });

  test('counts a frame that starts synchronized output and draws the box in one chunk', () => {
    expect(feed(`${SHELL}${SYNC_START}frame\n╰────╯${SYNC_END}`)).toEqual([true]);
  });

  test('waits for the box when the sync start arrives in its own chunk', () => {
    expect(feed(SHELL, SYNC_START, 'frame\n╭──╮', '╰──╯', 'later')).toEqual([
      false,
      false,
      false,
      true,
      true,
    ]);
  });

  test('does not count a box drawn before the sync start in the same chunk', () => {
    expect(feed(`${SHELL}${SYNC_START}frame`)).toEqual([false]);
  });

  test('finds a sync start split across two chunks', () => {
    const cut = 4;
    expect(feed(`${SHELL}${SYNC_START.slice(0, cut)}`, `${SYNC_START.slice(cut)}╰`)).toEqual([
      false,
      true,
    ]);
  });

  test('does not carry a box from before a split sync start into the count', () => {
    const cut = 4;
    expect(feed(`╰${SYNC_START.slice(0, cut)}`, SYNC_START.slice(cut))).toEqual([false, false]);
  });

  test('stays painted once it has painted', () => {
    expect(feed(`${SYNC_START}╰`, 'x', '')).toEqual([true, true, true]);
  });

  test('keeps separate state per detector', () => {
    const first = paintDetector();
    const second = paintDetector();
    expect(first(`${SYNC_START}╰`)).toBe(true);
    expect(second(SHELL)).toBe(false);
  });
});
