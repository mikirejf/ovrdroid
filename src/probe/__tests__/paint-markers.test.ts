import { describe, expect, test } from 'bun:test';

import type { MarkerResult, PaintFrames } from '../paint-markers.ts';
import {
  COMPACT_ROWS,
  describeResult,
  hasBlock,
  missingMarkers,
  NARROW_COLS,
  paintMarkers,
  readPaint,
  unescapeJs,
  UPDATE_FILE_UNDER_HOME,
  WORDMARK_ROWS,
} from '../paint-markers.ts';

const FIXTURE = { updateVersion: '9.9.9-test', additions: 2, deletions: 1 };
const MARKERS = paintMarkers(FIXTURE);

function centered(rows: readonly string[]): string[] {
  return rows.map((row) => `      ${row}`.trimEnd());
}

const LAUNCH = [
  '',
  ...centered(WORDMARK_ROWS),
  '                         v0.245.0',
  '        ↓ v9.9.9-test available · run ovrdroid update',
  '│ >                         │',
  '? for help                              +2 -1 | IDE ◌',
];

const TURN = ['⛬  ok', '[context: <1%, ↑<1m ↓<1m, cache 44m] ? for help      +2 -1 | IDE ◌'];

const KEEP_WARM_ON = [
  '●  Keep warm on for this session',
  '[⏱ 1s, ↑<1m ↓<1m, cache 44m, 🔥, context: <1%] ? for help      +2 -1 | IDE ◌',
];

const KEEP_WARM_OFF = [
  '●  Keep warm on for this session',
  '●  Keep warm off for this session',
  '[⏱ 1s, ↑<1m ↓<1m, cache 44m, context: <1%] ? for help      +2 -1 | IDE ◌',
];

const NARROW = ['', ...centered(COMPACT_ROWS), '            v0.245.0'];

const PATCHED: PaintFrames = {
  launch: LAUNCH,
  turn: TURN,
  keepWarmOn: KEEP_WARM_ON,
  keepWarmOff: KEEP_WARM_OFF,
  narrow: NARROW,
};

function resultFor(frames: PaintFrames, frame: string): MarkerResult {
  const result = readPaint(frames, MARKERS).find((candidate) => candidate.marker.frame === frame);
  if (result === undefined) {
    throw new Error(`no marker reads the ${frame} frame`);
  }
  return result;
}

describe('the markers come from the patch sources', () => {
  test('the wordmarks are the rows the logo patches write', () => {
    expect(WORDMARK_ROWS.length).toBeGreaterThan(1);
    expect(COMPACT_ROWS.join('\n')).toContain('O V R D R O I D');
  });

  test('the narrow width sits between the stock and the patched wordmark threshold', () => {
    expect(NARROW_COLS).toBeGreaterThan(58);
    expect(NARROW_COLS).toBeLessThan(76);
  });

  test('the update file is the one the release check writes', () => {
    expect(UPDATE_FILE_UNDER_HOME).toBe('.factory/ovrdroid/update.json');
  });

  test('JavaScript escapes decode', () => {
    expect(unescapeJs(String.raw`\u2193 v \xB7`)).toBe('↓ v ·');
  });
});

describe('missingMarkers', () => {
  test('a patched screen misses nothing', () => {
    expect(missingMarkers(PATCHED, MARKERS)).toEqual([]);
  });

  test('a stock screen misses every marker', () => {
    const stock: PaintFrames = {
      launch: ['  █████████    █████████', '1 config issue — /diagnostics      IDE ◌'],
      turn: ['⛬  ok', '[context: <1%] 1 config issue — /diagnostics'],
      keepWarmOn: ['●  Keep warm on for this session', '[context: <1%] ? for help'],
      keepWarmOff: ['●  Keep warm off for this session', '[context: <1%] ? for help'],
      narrow: ['  █████████    █████████'],
    };
    const missing = missingMarkers(stock, MARKERS).map((result) => result.marker);
    expect(missing).toEqual(MARKERS.filter((marker) => marker.gone !== true));
  });

  test('a frame never captured is not exercised, not passed', () => {
    const missing = missingMarkers({ launch: LAUNCH, narrow: NARROW }, MARKERS);
    expect(missing.map((result) => result.marker.frame)).toEqual([
      'turn',
      'turn',
      'keepWarmOn',
      'keepWarmOff',
    ]);
    expect(missing.every((result) => result.state === 'not captured')).toBe(true);
    expect(missing.every((result) => describeResult(result).includes('not exercised'))).toBe(true);
  });

  test('other diff counts do not pass for the fixture counts', () => {
    const launch = LAUNCH.map((line) => line.replace('+2 -1', '+3 -1'));
    const missing = missingMarkers({ ...PATCHED, launch }, MARKERS);
    expect(missing.map((result) => result.marker.patch)).toEqual(['diff-stats-footer-without-pr']);
  });

  test('a turn clock older than a minute still counts', () => {
    const turn = ['[context: 3%, ↑2m ↓1m, cache 41m] ? for help'];
    expect(missingMarkers({ ...PATCHED, turn }, MARKERS)).toEqual([]);
  });
});

describe('the keep-warm segment', () => {
  test('a chat notice alone is not the footer segment', () => {
    const keepWarmOn = ['●  Keep warm on for this session', '[context: <1%] ? for help'];
    expect(resultFor({ ...PATCHED, keepWarmOn }, 'keepWarmOn').state).toBe('missing');
  });

  test('the word outside the footer bracket is not the segment', () => {
    const keepWarmOn = ['🔥', '[⏱ 1s, ↑<1m ↓<1m, cache 44m, context: <1%] ? for help'];
    expect(resultFor({ ...PATCHED, keepWarmOn }, 'keepWarmOn').state).toBe('missing');
  });

  test('the segment in the footer reads as in the footer after /keep-warm on', () => {
    const result = resultFor(PATCHED, 'keepWarmOn');
    expect(result.state).toBe('shown');
    expect(describeResult(result)).toBe(
      'ok    the keep-warm segment (turn-clock-parts) is in the footer after /keep-warm on',
    );
  });

  test('a footer that still has the segment after off fails', () => {
    const keepWarmOff = ['●  Keep warm off for this session', ...KEEP_WARM_ON.slice(1)];
    const result = resultFor({ ...PATCHED, keepWarmOff }, 'keepWarmOff');
    expect(result.state).toBe('missing');
    expect(describeResult(result)).toContain('still in the footer');
  });

  test('a footer without the segment passes after off, whatever the chat says', () => {
    const result = resultFor(PATCHED, 'keepWarmOff');
    expect(result.state).toBe('shown');
    expect(describeResult(result)).toBe(
      'ok    the keep-warm segment (turn-clock-parts) is gone from the footer after /keep-warm off',
    );
  });
});

describe('hasBlock', () => {
  test('rows must be on consecutive lines', () => {
    expect(hasBlock(['a1', 'x', 'b2'], ['a', 'b'])).toBe(false);
    expect(hasBlock(['x', 'a1', 'b2'], ['a', 'b'])).toBe(true);
  });
});
