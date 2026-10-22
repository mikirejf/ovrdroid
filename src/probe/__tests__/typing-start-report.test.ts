import { describe, expect, test } from 'bun:test';

import type { TypingStartRun } from '../typing-start-report.ts';
import {
  describeTypingStart,
  StartupTimeline,
  typingStartMeasure,
} from '../typing-start-report.ts';

const SYNC_START = '\u001B[?2026h';
const SHELL = 'logo\ntip\n╭────╮\n│ > │\n╰────╯';
const FRAME = `${SYNC_START}frame\n╭────╮\n│ > │\n╰────╯`;

function timelineOf(...chunks: [number, string][]): StartupTimeline {
  const timeline = new StartupTimeline();
  for (const [atMs, text] of chunks) {
    timeline.feed(text, atMs);
  }
  return timeline;
}

function run(shellMs: number, appMs: number, pairs = 20): TypingStartRun {
  return { shellMs, appMs, pairs };
}

describe('StartupTimeline', () => {
  test('stamps the shell at the first box and the app at the first synchronized box', () => {
    const timeline = timelineOf([90, 'probe'], [100, SHELL], [130, '/'], [760, FRAME]);
    expect(timeline.shellAt).toBe(100);
    expect(timeline.appAt).toBe(760);
  });

  test('keeps the first stamp when more boxes arrive', () => {
    const timeline = timelineOf([100, SHELL], [200, SHELL], [700, FRAME], [800, FRAME]);
    expect(timeline.shellAt).toBe(100);
    expect(timeline.appAt).toBe(700);
  });

  test('has no shell stamp when the first box is the app frame', () => {
    const timeline = timelineOf([300, FRAME]);
    expect(timeline.shellAt).toBeUndefined();
    expect(timeline.appAt).toBe(300);
  });

  test('stamps the shell from the part of a chunk before the sync start', () => {
    const timeline = timelineOf([100, `${SHELL}${SYNC_START}frame`], [500, '╰']);
    expect(timeline.shellAt).toBe(100);
    expect(timeline.appAt).toBe(500);
  });

  test('does not take a box after a sync start split across chunks for the shell', () => {
    const cut = 4;
    const timeline = timelineOf(
      [100, SYNC_START.slice(0, cut)],
      [110, `${SYNC_START.slice(cut)}╰`],
    );
    expect(timeline.shellAt).toBeUndefined();
    expect(timeline.appAt).toBe(110);
  });

  test('has no app stamp while only the shell has drawn', () => {
    const timeline = timelineOf([100, SHELL], [400, 'echo']);
    expect(timeline.shellAt).toBe(100);
    expect(timeline.appAt).toBeUndefined();
  });
});

describe('typingStartMeasure', () => {
  test('carries the app paint of each binary under a label naming the gap', () => {
    const measure = typingStartMeasure(25, [
      ['stock', [run(90, 760), run(95, 770)]],
      ['target', [run(100, 1100), run(98, 1090)]],
    ]);
    expect(measure.label).toBe('app paint, a key every 25ms');
    expect(measure.series).toEqual([
      ['stock', [760, 770]],
      ['target', [1100, 1090]],
    ]);
  });
});

describe('describeTypingStart', () => {
  test('says the gap, then the shell and app paint of each binary and the keys typed', () => {
    const lines = describeTypingStart(100, [
      ['stock', [run(90, 760, 7), run(110, 780, 8)]],
      ['target', [run(100, 800, 8), run(100, 820, 9)]],
    ]);
    expect(lines).toEqual([
      "a key every 100ms, from the shell's input box until the app frame",
      '  stock',
      '    shell min 90  p25 95  median 100  p75 105',
      '    app   min 760  p25 765  median 770  p75 775',
      '    all   760 780',
      '    keys  7 8 pairs typed per run',
      '  target',
      '    shell min 100  p25 100  median 100  p75 100',
      '    app   min 800  p25 805  median 810  p75 815',
      '    all   800 820',
      '    keys  8 9 pairs typed per run',
    ]);
  });
});
