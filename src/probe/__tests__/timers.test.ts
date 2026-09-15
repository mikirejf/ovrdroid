import { describe, expect, test } from 'bun:test';

import { timerPatches, TIMER_VARIABLE } from '../../patch/timer-patches.ts';
import { formatTimers, parseTimers, summariseTimers, TIMERS_HEADER } from '../timers.ts';

const LOG = [
  '1000\t50\tarm\tinterval\t1000\t() => tick()',
  '2000\t50\tfire\tinterval\t1000\t() => tick()',
  '3000\t50\tfire\tinterval\t1000\t() => tick()',
  '3000\t50\tfire\ttimeout\t400\t() => startWatching()',
  '4000\t50\tfire\tinterval\t1000\t() => tick()',
].join('\n');

describe('parseTimers groups fires by the code that armed them', () => {
  const report = parseTimers(LOG);

  test('the window spans the first fire to the last', () => {
    expect(report.windowMs).toBe(2000);
  });

  test('arming and firing are counted separately', () => {
    expect(report.armed).toBe(1);
    expect(report.fires).toBe(4);
  });

  test('a 2s window of 3 fires becomes 90 wake-ups a minute', () => {
    expect(report.costs.at(0)?.firesPerMinute).toBe(90);
  });

  test('the busiest site sorts first', () => {
    expect(report.costs.at(0)?.site).toContain('tick');
    expect(report.costs.at(0)?.fires).toBe(3);
  });

  test('a one-shot timeout is kept apart from the interval', () => {
    const once = report.costs.find((cost) => cost.kind === 'timeout');
    expect(once?.fires).toBe(1);
    expect(once?.delayMs).toBe(400);
  });
});

describe('parseTimers refuses junk', () => {
  test('unknown kinds and events are dropped', () => {
    expect(parseTimers('1000\t50\tarm\tmystery\t1\tx').fires).toBe(0);
    expect(parseTimers('abc\t50\tfire\tinterval\t1\tx').fires).toBe(0);
  });

  test('a truncated row is dropped rather than half-read', () => {
    expect(parseTimers('1000\t50\tfire\tinterval').fires).toBe(0);
  });

  test('an empty log yields zeroes rather than NaN', () => {
    const empty = parseTimers('');
    expect([empty.armed, empty.fires, empty.firesPerMinute]).toEqual([0, 0, 0]);
  });
});

describe('the report reads as plain text', () => {
  test('the summary names the wake-up rate', () => {
    expect(summariseTimers(parseTimers(LOG))).toContain('wake-ups per minute');
  });

  test('every site gets a row under the header', () => {
    expect(TIMERS_HEADER).toContain('site');
    expect(formatTimers(parseTimers(LOG).costs).split('\n')).toHaveLength(2);
  });
});

describe('the timer patch stays anchored', () => {
  const [census] = timerPatches;

  test('it anchors on the bundle header, which must stay first', () => {
    expect(census?.find).toBe('// @bun @bytecode');
    expect(census?.replace.startsWith('// @bun @bytecode')).toBe(true);
  });

  test('it wraps both timer functions', () => {
    expect(census?.replace).toContain('globalThis.setInterval=');
    expect(census?.replace).toContain('globalThis.setTimeout=');
  });

  test('it stays silent unless the log variable is set', () => {
    expect(census?.replace).toContain(`process.env.${TIMER_VARIABLE}`);
  });

  test('it calls through to the original timer', () => {
    expect(census?.replace).toContain('original.call');
  });
});
