import { describe, expect, test } from 'bun:test';

import { SYNC_START } from '../input-box.ts';
import { paintDetector } from '../launch.ts';

const SYNC_END = '\u001B[?2026l';
const SHELL = 'logo\ntip\n╭────╮\n│ > │\n╰────╯';
const STOCK_BOX = '╭────╮\n│ > │\n╰────╯';
const PATCHED_BOX = '────\n  > \n────';

function feed(...chunks: string[]): boolean[] {
  const isPainted = paintDetector();
  return chunks.map((chunk) => isPainted(chunk));
}

async function captured(name: string): Promise<string[]> {
  const file = Bun.file(`${import.meta.dir}/app-frame-${name}.fixture.json`);
  const parsed: unknown = await file.json();
  if (!Array.isArray(parsed) || !parsed.every((chunk) => typeof chunk === 'string')) {
    throw new Error(`${name} fixture is not a list of strings`);
  }
  return parsed;
}

function referenceDetector(): (text: string) => boolean {
  let tail = '';
  let synced = false;
  let painted = false;

  return (text) => {
    if (painted) {
      return true;
    }
    const window = tail + text;
    if (synced) {
      painted = text.includes('╰');
    } else {
      const start = window.indexOf(SYNC_START);
      synced = start !== -1;
      painted = synced && window.slice(start + SYNC_START.length).includes('╰');
    }
    tail = window.slice(1 - SYNC_START.length);
    return painted;
  };
}

function firstPaint(isPainted: (text: string) => boolean, chunks: readonly string[]): number {
  return chunks.findIndex((chunk) => isPainted(chunk));
}

describe('paintDetector', () => {
  test('never counts the early shell, which has a box but no synchronized output', () => {
    expect(feed(SHELL, SHELL, 'more')).toEqual([false, false, false]);
  });

  test('counts a frame that starts synchronized output and draws a stock box in one chunk', () => {
    expect(feed(`${SHELL}${SYNC_START}frame\n${STOCK_BOX}${SYNC_END}`)).toEqual([true]);
  });

  test('counts a frame that draws the patched box between two rules', () => {
    expect(feed(`${SHELL}${SYNC_START}frame\n${PATCHED_BOX}${SYNC_END}`)).toEqual([true]);
  });

  test('waits for the whole box when the sync start arrives in its own chunk', () => {
    expect(feed(SHELL, SYNC_START, 'frame\n╭──╮\n│ > │\n', '╰──╯', 'later')).toEqual([
      false,
      false,
      false,
      true,
      true,
    ]);
  });

  test('waits for the bottom rule of the patched box', () => {
    expect(feed(SYNC_START, 'frame\n────\n  > hi\n', '────', 'later')).toEqual([
      false,
      false,
      true,
      true,
    ]);
  });

  test('a rule line without the prompt row under it is not the input box', () => {
    expect(feed(`${SYNC_START}frame\n────\nplain text\n────\n`)).toEqual([false]);
  });

  test('does not count a box drawn before the sync start in the same chunk', () => {
    expect(feed(`${SHELL}${SYNC_START}frame`)).toEqual([false]);
  });

  test('finds a sync start split across two chunks', () => {
    const cut = 4;
    expect(
      feed(`${SHELL}${SYNC_START.slice(0, cut)}`, `${SYNC_START.slice(cut)}${STOCK_BOX}`),
    ).toEqual([false, true]);
  });

  test('does not carry a box from before a split sync start into the count', () => {
    const cut = 4;
    expect(feed(`${STOCK_BOX}${SYNC_START.slice(0, cut)}`, SYNC_START.slice(cut))).toEqual([
      false,
      false,
    ]);
  });

  test('stays painted once it has painted', () => {
    expect(feed(`${SYNC_START}${STOCK_BOX}`, 'x', '')).toEqual([true, true, true]);
  });

  test('keeps separate state per detector', () => {
    const first = paintDetector();
    const second = paintDetector();
    expect(first(`${SYNC_START}${STOCK_BOX}`)).toBe(true);
    expect(second(SHELL)).toBe(false);
  });
});

describe('paintDetector on a launch captured from a real Droid 1.1.0 at 120x40', () => {
  test('stock: the shell chunks never count and the app frame counts in the chunk the old bottom-left corner match did', async () => {
    const chunks = await captured('stock');
    const at = firstPaint(paintDetector(), chunks);
    expect(at).toBe(13);
    expect(firstPaint(referenceDetector(), chunks)).toBe(at);
    expect(chunks.slice(0, at).some((chunk) => chunk.includes(SYNC_START))).toBe(true);
  });

  test('patched: the shell chunks never count and the app frame counts in its first synchronized frame', async () => {
    const chunks = await captured('patched');
    const at = firstPaint(paintDetector(), chunks);
    expect(at).toBe(13);
    const syncAt = chunks.findIndex((chunk) => chunk.includes(SYNC_START));
    expect(syncAt).toBeLessThan(at);
    expect(chunks.slice(syncAt, at).some((chunk) => chunk.includes(SYNC_END))).toBe(false);
  });

  test('the old match never fired on the patched launch, which draws no bottom-left corner', async () => {
    const chunks = await captured('patched');
    expect(firstPaint(referenceDetector(), chunks)).toBe(-1);
  });
});
