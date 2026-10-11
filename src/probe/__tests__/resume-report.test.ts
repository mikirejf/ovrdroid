import { describe, expect, test } from 'bun:test';

import type { ResumeRun } from '../resume-report.ts';
import {
  asksForTrust,
  formatResume,
  readRedraw,
  readResume,
  redrawn,
  seriesOf,
} from '../resume-report.ts';

const MARKER = 'LAST-REPLY';
const BOX = '╭───╮\n│ > │\n╰───╯';
const LAYOUT = { turns: 150, quietMs: 1500, resizeCols: 100 };

const FRAMES = [
  { atMs: 420, text: 'Checking authentication...' },
  { atMs: 500, text: `logo\n${BOX}` },
  { atMs: 1300, text: `turn 1 ... ${MARKER}\n${BOX}` },
  { atMs: 1400, text: BOX },
];

function run(paintMs: number, redrawMs = 1100): ResumeRun {
  return {
    paintMs,
    landedMs: paintMs + 800,
    settledMs: paintMs + 900,
    frames: 4,
    bytes: 260_000,
    cpuMs: 1200,
    redraw: { settledMs: redrawMs, frames: 3, bytes: 290_000, cpuMs: 900 },
  };
}

describe('readResume times the resume from spawn', () => {
  test('the input box, the last reply and the last frame each get a time after spawn', () => {
    const reading = readResume(FRAMES, { marker: MARKER, spawnOffsetMs: 20, bytes: 263_000 });
    expect(reading).toEqual({
      paintMs: 480,
      landedMs: 1280,
      settledMs: 1380,
      frames: 4,
      bytes: 263_000,
    });
  });

  test('a resume whose last reply never shows is an error, not a fast run', () => {
    expect(() =>
      readResume(FRAMES.slice(0, 2), { marker: MARKER, spawnOffsetMs: 0, bytes: 0 }),
    ).toThrow('never showed');
  });
});

describe('asksForTrust spots the folder trust dialog', () => {
  test('the dialog also draws a box, so only its title tells it apart', () => {
    expect(asksForTrust([{ atMs: 0, text: `Trust this folder?\n${BOX}` }])).toBe(true);
    expect(asksForTrust(FRAMES)).toBe(false);
  });
});

function boxOf(cols: number): string {
  return `╭${'─'.repeat(cols - 2)}╮\n│ > │\n╰${'─'.repeat(cols - 2)}╯`;
}

const NARROW = 100;
const WIDE = 120;
const REDRAW = { marker: MARKER, cols: NARROW, bytes: 290_000, cpuMs: 900 };

describe('readRedraw reads the frames after the resize', () => {
  test('the last frame marks when the redraw went quiet', () => {
    const frames = [
      { atMs: 10, text: boxOf(NARROW) },
      { atMs: 1700, text: `turn 1 ... ${MARKER}\n${boxOf(NARROW)}` },
      { atMs: 1750, text: boxOf(NARROW) },
    ];
    expect(readRedraw(frames, REDRAW)).toEqual({
      settledMs: 1750,
      frames: 3,
      bytes: 290_000,
      cpuMs: 900,
    });
  });

  test('the quick frames before the transcript repaints are not a finished redraw', () => {
    expect(() => readRedraw([{ atMs: 10, text: boxOf(NARROW) }], REDRAW)).toThrow(
      'no frame at 100 columns reached the last fixture reply',
    );
  });

  test('a late frame still drawn at the old width is not the redraw', () => {
    const late = [{ atMs: 18, text: `turn 1 ... ${MARKER}\n${boxOf(WIDE)}` }];
    expect(redrawn(late, MARKER, NARROW)).toBe(false);
    expect(redrawn(late, MARKER, WIDE)).toBe(true);
  });
});

describe('formatResume', () => {
  test('every measure is summarised, the resize included', () => {
    const text = formatResume([run(500, 1100), run(520, 1150)], LAYOUT);
    expect(text).toContain('input box   min 500');
    expect(text).toContain('the last of 150 turns showed');
    expect(text).toContain('resize      min 1100');
    expect(text).toContain('100 columns');
  });
});

describe('seriesOf', () => {
  test('picks one number from each run, per binary', () => {
    const series = seriesOf(
      [
        ['a', [run(500, 1100), run(510, 1200)]],
        ['b', [run(400, 900)]],
      ],
      (one) => one.redraw.settledMs,
    );
    expect(series).toEqual([
      ['a', [1100, 1200]],
      ['b', [900]],
    ]);
  });
});
