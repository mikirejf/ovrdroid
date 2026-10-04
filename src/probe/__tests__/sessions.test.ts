import { describe, expect, test } from 'bun:test';

import type { Frame } from '../session.ts';
import { waitMs } from '../sessions-report.ts';
import { describeSessions, readSessionsList } from '../sessions.ts';

const MENU = '│ > /sessions │\n  /sessions   List and select previous sessions to resume';
const LIST = [
  '│ Sessions │',
  '│   Modified  Created   Size   Title │',
  '│   Just now  1m ago    51     Diagnose slow /sessions load │',
  '  ↑↓ navigate   Enter select   Esc close   1-20 of 284',
].join('\n');

function frame(atMs: number, text: string): Frame {
  return { atMs, text };
}

describe('readSessionsList', () => {
  test('times the first frame that draws the list, not the command menu before it', () => {
    const reading = readSessionsList([frame(40, MENU), frame(193, LIST), frame(700, LIST)]);

    expect(reading).toEqual({ shownMs: 193, total: 284 });
  });

  test('a list that never draws reads as never', () => {
    expect(readSessionsList([frame(40, MENU)])).toEqual({ shownMs: undefined, total: undefined });
  });

  test('takes the count from the newest frame, which the background reload may have changed', () => {
    const reloaded = LIST.replace('of 284', 'of 285');

    expect(readSessionsList([frame(150, LIST), frame(650, reloaded)]).total).toBe(285);
  });
});

describe('describeSessions', () => {
  test('reports each run and the median per open', () => {
    const text = describeSessions([
      [
        { shownMs: 1040, total: 284 },
        { shownMs: 160, total: 284 },
      ],
      [
        { shownMs: 660, total: 284 },
        { shownMs: 170, total: 284 },
      ],
      [
        { shownMs: 870, total: 284 },
        { shownMs: 180, total: 284 },
      ],
    ]);

    expect(text).toContain('run 1: 1040ms, 160ms');
    expect(text).toContain('first open: the list showed a median 870ms after Enter');
    expect(text).toContain('open 2: the list showed a median 170ms after Enter');
    expect(text).toContain('the first tab listed 284 sessions');
  });

  test('says how many runs never showed the list', () => {
    const text = describeSessions([
      [{ shownMs: undefined, total: undefined }],
      [{ shownMs: 200, total: 9 }],
    ]);

    expect(text).toContain('run 1: never');
    expect(text).toContain('median 200ms after Enter, and never showed in 1 of 2 runs');
  });
});

describe('waitMs', () => {
  test('accepts 0, which types /sessions as soon as the input box shows', () => {
    expect(waitMs('0')).toBe(0);
    expect(waitMs('1500')).toBe(1500);
  });

  test('rejects a negative or fractional wait', () => {
    expect(() => waitMs('-1')).toThrow('0 or more');
    expect(() => waitMs('1.5')).toThrow('0 or more');
  });
});
