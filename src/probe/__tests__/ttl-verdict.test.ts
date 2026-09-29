import { describe, expect, test } from 'bun:test';

import { clockTestDecides, verdict } from '../ttl-verdict.ts';
import { SCHEDULES } from '../ttl.ts';
import { outcomes, read, usage, wrote } from './usage.ts';

describe('clockTestDecides says whether a clock-start run can separate the two clocks', () => {
  const TTL = 300;

  test('a short answer inside the gap leaves both clocks predicting a hit', () => {
    expect(clockTestDecides(39, 240, TTL)).toBe(false);
  });

  test('an answer that pushes the total past the TTL separates them', () => {
    expect(clockTestDecides(150, 240, TTL)).toBe(true);
  });

  test('a gap already past the TTL decides nothing, since both clocks miss', () => {
    expect(clockTestDecides(150, 360, TTL)).toBe(false);
  });
});

describe('the verdict states the answer the schedule was built for', () => {
  test('cliff names the longest gap that held and the first that missed', () => {
    const steps = SCHEDULES.cliff({ minutes: [3, 4, 5] });
    const report = verdict(
      'cliff',
      outcomes([wrote(27_000), read(27_000), read(27_000), wrote(27_000)]),
      steps,
    );
    expect(report).toBe('the cache held through a 4m gap and missed at 5m');
  });

  test('cliff says so when no gap missed', () => {
    const steps = SCHEDULES.cliff({ minutes: [3, 4] });
    expect(verdict('cliff', outcomes([wrote(100), read(100), read(100)]), steps)).toContain(
      'held through every gap, the longest being 4m',
    );
  });

  test('cliff calls a partial read ambiguous instead of picking a side', () => {
    const steps = SCHEDULES.cliff({ minutes: [3, 4] });
    const partial = usage({ read: 60, write: 40, write5m: 40 });
    expect(verdict('cliff', outcomes([wrote(100), partial, wrote(100)]), steps)).toContain(
      'ambiguous',
    );
  });

  test('refresh says a read refreshes the TTL when only the 6m gap missed', () => {
    const steps = SCHEDULES.refresh({ minutes: [] });
    const results = [wrote(100), read(100), read(100), read(100), wrote(100)];
    const report = verdict('refresh', outcomes(results), steps);
    expect(report).toContain('3 gaps of 4m all read the full prefix, so a read refreshes the TTL');
    expect(report).toContain('only the 6m gap missed');
  });

  test('refresh says the opposite when a 4m gap already missed', () => {
    const steps = SCHEDULES.refresh({ minutes: [] });
    const results = [wrote(100), read(100), wrote(100), wrote(100), wrote(100)];
    expect(verdict('refresh', outcomes(results), steps)).toContain(
      'a 4m gap missed, so a read does not refresh the TTL',
    );
  });

  test('one-hour reports a write that survived the 20m gap', () => {
    const steps = SCHEDULES['one-hour']({ minutes: [] });
    const first = usage({ read: 0, write: 27_136, write1h: 27_136 });
    expect(verdict('one-hour', outcomes([first, read(27_136)]), steps)).toContain(
      'a 1h write survived a 20m gap',
    );
  });

  test('one-hour catches a proxy that downgraded the 1h request to 5m', () => {
    const steps = SCHEDULES['one-hour']({ minutes: [] });
    expect(verdict('one-hour', outcomes([wrote(100), wrote(100)]), steps)).toContain(
      'ttl 1h did not reach the API',
    );
  });

  test('clock-start reads a miss as the clock starting at request start', () => {
    const steps = SCHEDULES['clock-start']({ minutes: [] });
    const slow = outcomes([wrote(100), wrote(100)], [150]);
    expect(verdict('clock-start', slow, steps)).toContain('the clock starts at request start');
  });

  test('clock-start reads a hit as the clock starting when the response ends', () => {
    const steps = SCHEDULES['clock-start']({ minutes: [] });
    const slow = outcomes([wrote(100), read(100)], [150]);
    expect(verdict('clock-start', slow, steps)).toContain(
      'the clock starts when the response ends',
    );
  });

  test('clock-start refuses a verdict when a short answer left both clocks agreeing', () => {
    const steps = SCHEDULES['clock-start']({ minutes: [] });
    const quick = outcomes([wrote(100), read(100)], [39]);
    const report = verdict('clock-start', quick, steps);
    expect(report).toContain('the run decides nothing');
    expect(report).not.toContain('the clock starts');
  });

  test('promote reports whether the last send read the whole prefix', () => {
    const steps = SCHEDULES.promote({ minutes: [] });
    const results = [wrote(100), usage({ read: 0, write: 0 }), read(100)];
    expect(verdict('promote', outcomes(results), steps)).toContain(
      'so a 1h re-send extended the TTL',
    );
  });

  test('mixed reports how the write split between the two TTLs', () => {
    const steps = SCHEDULES.mixed({ minutes: [] });
    const first = usage({ read: 0, write: 400, write5m: 100, write1h: 300 });
    const second = usage({ read: 300, write: 100, write5m: 100 });
    const report = verdict('mixed', outcomes([first, second]), steps);
    expect(report).toContain('the write split 300 tokens at 1h and 100 at 5m');
    expect(report).toContain('only 300 tokens still read');
  });

  test('price counts the writes and reads to bill against the price table', () => {
    const steps = SCHEDULES.price({ minutes: [] });
    const third = usage({ read: 0, write: 100, write1h: 100 });
    const report = verdict('price', outcomes([wrote(100), read(100), third, read(100)]), steps);
    expect(report).toBe('2 sends wrote, 2 read; bill each against the per-model price table');
  });

  test('a 5m write billed as 1h tokens is called out as an endpoint upgrade', () => {
    const steps = SCHEDULES.price({ minutes: [] });
    const upgraded = usage({ read: 0, write: 100, write1h: 100 });
    const report = verdict('price', outcomes([upgraded, read(100), upgraded, read(100)]), steps);
    expect(report).toContain('this endpoint upgrades every write to 1h');
  });

  test('a timed schedule carries the upgrade note so the 5m verdict is not over-read', () => {
    const steps = SCHEDULES.cliff({ minutes: [6] });
    const upgraded = usage({ read: 0, write: 100, write1h: 100 });
    const report = verdict('cliff', outcomes([upgraded, read(100)]), steps);
    expect(report).toContain('the cache held through every gap');
    expect(report).toContain('the 5m TTL was never under test here');
  });

  test('unrelated says the other request kept the cache warm when main still reads', () => {
    const steps = SCHEDULES.unrelated({ minutes: [] });
    const report = verdict('unrelated', outcomes([wrote(100), wrote(100), read(100)]), steps);
    expect(report).toBe(
      'the other request read 0 and wrote 100\nthe other request kept this cache warm',
    );
  });

  test('unrelated says the clock was not reset when main missed at 6m', () => {
    const steps = SCHEDULES.unrelated({ minutes: [] });
    const report = verdict('unrelated', outcomes([wrote(100), wrote(100), wrote(100)]), steps);
    expect(report).toContain(
      "the other request did not reset this cache's clock: it expired at 6m",
    );
  });

  test('shared-head reports the head read and the tail re-write separately', () => {
    const steps = SCHEDULES['shared-head']({ minutes: [] });
    const other = usage({ read: 25, write: 75, write5m: 75 });
    const last = usage({ read: 25, write: 75, write5m: 75 });
    const report = verdict('shared-head', outcomes([wrote(100), other, last]), steps);
    expect(report).toContain('the other request read 25 and wrote 75');
    expect(report).toContain(
      'head read 25, tail re-written 75, so only the shared head stayed warm',
    );
  });

  test('shared-head says the whole cache stayed warm when main reads it all', () => {
    const steps = SCHEDULES['shared-head']({ minutes: [] });
    const other = usage({ read: 25, write: 75, write5m: 75 });
    const report = verdict('shared-head', outcomes([wrote(100), other, read(100)]), steps);
    expect(report).toContain('the other request kept this cache warm');
  });

  test('shared-head says the clock was not reset when main read nothing', () => {
    const steps = SCHEDULES['shared-head']({ minutes: [] });
    const report = verdict('shared-head', outcomes([wrote(100), wrote(100), wrote(100)]), steps);
    expect(report).toContain("did not reset this cache's clock: it expired at 6m");
  });

  test('hour-refresh says the read slid the clock when the 108m send still reads', () => {
    const steps = SCHEDULES['hour-refresh']({ minutes: [] });
    const results = [wrote(100), read(100), usage({ read: 95, write: 5, write1h: 5 })];
    expect(verdict('hour-refresh', outcomes(results), steps)).toBe(
      'a read at 54m slid the 1h clock: the entry lived 108m',
    );
  });

  test('hour-refresh says the entry died before 54m when the middle send read nothing', () => {
    const steps = SCHEDULES['hour-refresh']({ minutes: [] });
    const results = [wrote(100), wrote(100), read(100)];
    expect(verdict('hour-refresh', outcomes(results), steps)).toBe('the entry did not survive 54m');
  });

  test('hour-refresh says the clock did not slide when only the 108m send missed', () => {
    const steps = SCHEDULES['hour-refresh']({ minutes: [] });
    const results = [wrote(100), read(100), wrote(100)];
    expect(verdict('hour-refresh', outcomes(results), steps)).toBe(
      'the read at 54m did not slide the clock: the entry expired before 108m',
    );
  });

  test('hour-refresh does not count a read under 90% of the prefix as a slide', () => {
    const steps = SCHEDULES['hour-refresh']({ minutes: [] });
    const results = [wrote(100), read(100), usage({ read: 50, write: 50, write1h: 50 })];
    expect(verdict('hour-refresh', outcomes(results), steps)).toContain('did not slide the clock');
  });

  test('hour-cliff says the entry outlived 1h when the 66m send reads', () => {
    const steps = SCHEDULES['hour-cliff']({ minutes: [] });
    expect(verdict('hour-cliff', outcomes([wrote(100), read(100)]), steps)).toBe(
      "the entry outlived 66m with no read: the proxy's lifetime is longer than 1h",
    );
  });

  test('hour-cliff says the entry expired inside the last 6m when the 66m send misses', () => {
    const steps = SCHEDULES['hour-cliff']({ minutes: [] });
    expect(verdict('hour-cliff', outcomes([wrote(100), wrote(100)]), steps)).toBe(
      'expired between 60m and 66m with no read',
    );
  });

  test('no results at all says so rather than throwing', () => {
    expect(verdict('price', [], SCHEDULES.price({ minutes: [] }))).toBe('no sends landed');
  });
});
