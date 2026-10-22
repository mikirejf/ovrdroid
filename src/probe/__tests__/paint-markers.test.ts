import { describe, expect, test } from 'bun:test';

import type { PaintFrames } from '../paint-markers.ts';
import {
  COMPACT_ROWS,
  describeResult,
  hasBlock,
  missingMarkers,
  NARROW_COLS,
  paintMarkers,
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

const NARROW = ['', ...centered(COMPACT_ROWS), '            v0.245.0'];

const PATCHED: PaintFrames = { launch: LAUNCH, turn: TURN, narrow: NARROW };

describe('the markers come from the patch sources', () => {
  test('the wordmarks are the rows the logo patches write', () => {
    expect(WORDMARK_ROWS.length).toBeGreaterThan(1);
    expect(COMPACT_ROWS.join('\n')).toContain('O V R D R O I D');
  });

  test('the narrow width sits between the stock and the patched wordmark threshold', () => {
    expect(NARROW_COLS).toBeGreaterThan(58);
    expect(NARROW_COLS).toBeLessThan(76);
  });

  test('the update file is the one the notice patch writes', () => {
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
      narrow: ['  █████████    █████████'],
    };
    expect(missingMarkers(stock, MARKERS).map((result) => result.state)).toEqual(
      MARKERS.map(() => 'missing'),
    );
  });

  test('a frame never captured is not exercised, not passed', () => {
    const missing = missingMarkers({ launch: LAUNCH, narrow: NARROW }, MARKERS);
    expect(missing.map((result) => result.marker.frame)).toEqual(['turn', 'turn']);
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

describe('hasBlock', () => {
  test('rows must be on consecutive lines', () => {
    expect(hasBlock(['a1', 'x', 'b2'], ['a', 'b'])).toBe(false);
    expect(hasBlock(['x', 'a1', 'b2'], ['a', 'b'])).toBe(true);
  });
});
