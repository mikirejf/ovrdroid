import { describe, expect, test } from 'bun:test';

import { watchPatches } from '../../patch/watch-patches.ts';
import { formatWatch, parseWatch, summariseWatch, WATCH_HEADER } from '../watch.ts';

const LOG = [
  '100\tfsevent\trelevant\tsettings.json',
  '101\tfsevent\tignored\tlogs/droid.log',
  '102\tschedule\tsettings\t/Users/x/.factory',
  '150\tstatus\tready->refreshing\t122 commands',
  '300\tstatus\trefreshing->ready\t122 commands',
  '310\tcache-write\t/Users/x/.factory/cache/slash-command-catalogs/a.json',
].join('\n');

describe('parseWatch turns the log into counts a person can read', () => {
  const report = parseWatch(LOG);

  test('relevant and ignored events are separated', () => {
    expect(report.relevantEvents).toBe(1);
    expect(report.ignoredEvents).toBe(1);
  });

  test('a rescan is counted only when the status enters refreshing', () => {
    expect(report.rescans).toBe(1);
  });

  test('wake-ups and cache writes are counted', () => {
    expect(report.schedules).toBe(1);
    expect(report.cacheWrites).toBe(1);
  });

  test('rows come back in time order', () => {
    expect(report.rows.map((row) => row.atMs)).toEqual([100, 101, 102, 150, 300, 310]);
  });

  test('a row without a detail column keeps its whole subject', () => {
    const write = report.rows.at(-1);
    expect(write?.kind).toBe('cache-write');
    expect(write?.subject).toContain('slash-command-catalogs');
  });
});

describe('parseWatch refuses junk', () => {
  test('unknown kinds and unparsable times are dropped', () => {
    expect(parseWatch('abc\tfsevent\trelevant\tx').rows).toEqual([]);
    expect(parseWatch('100\tmystery\trelevant\tx').rows).toEqual([]);
    expect(parseWatch('100\tfsevent').rows).toEqual([]);
  });

  test('an empty log yields an empty report', () => {
    const empty = parseWatch('');
    expect(empty.rows).toEqual([]);
    expect(empty.rescans).toBe(0);
  });
});

describe('the report reads as plain text', () => {
  test('every row appears in the formatted table', () => {
    const lines = formatWatch(parseWatch(LOG).rows).split('\n');
    expect(lines).toHaveLength(6);
    expect(WATCH_HEADER).toContain('kind');
  });

  test('the summary names all four counts', () => {
    const summary = summariseWatch(parseWatch(LOG));
    expect(summary).toContain('1 relevant file events');
    expect(summary).toContain('1 catalog rescans');
  });
});

describe('the watch patches stay anchored', () => {
  test('every patch has a distinct name', () => {
    const names = watchPatches.map((patch) => patch.name);
    expect(new Set(names).size).toBe(names.length);
  });

  test('every replacement keeps the code it anchors on', () => {
    for (const patch of watchPatches) {
      expect(patch.replace).toContain('__owd');
      expect(patch.find.length).toBeGreaterThan(0);
    }
  });

  test('the status patch logs before the early return that hides equal states', () => {
    const status = watchPatches.find((patch) => patch.name === 'watch-catalog-status');
    expect(status?.replace.indexOf('__owd("status')).toBeLessThan(
      status?.replace.indexOf('return!1') ?? 0,
    );
  });

  test('no patch anchors on the catalog function header, which other patches rewrite', () => {
    for (const patch of watchPatches) {
      expect(patch.find).not.toContain('function Td(T){');
    }
  });
});
