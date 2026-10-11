import { describe, expect, test } from 'bun:test';

import { formatLag, lagText, parseLag, rowsIn, summariseLag } from '../lag.ts';

interface LineOptions {
  t: number;
  pid: number;
  p99: number;
  max?: number;
  busy?: number;
}

function line(options: LineOptions): string {
  const { t, pid, p99 } = options;
  return JSON.stringify({
    t,
    pid,
    n: 20,
    p50: 1,
    p99,
    max: options.max ?? p99,
    busy: options.busy ?? 0,
  });
}

const TEXT = [
  line({ t: 3000, pid: 7, p99: 40, max: 300, busy: 0.5 }),
  line({ t: 1000, pid: 7, p99: 2 }),
  line({ t: 2000, pid: 7, p99: 10, busy: 0.1 }),
  line({ t: 1500, pid: 9, p99: 5 }),
  'junk',
  JSON.stringify({ t: 1, pid: 7 }),
].join('\n');

describe('parseLag reads the rows of each process in time order', () => {
  const log = parseLag(TEXT);

  test('rows are grouped per pid', () => {
    expect([...log.series.keys()].toSorted((a, b) => a - b)).toEqual([7, 9]);
  });

  test('rows come back in time order', () => {
    expect(log.series.get(7)?.map((row) => row.t)).toEqual([1000, 2000, 3000]);
  });

  test('junk and rows with a missing field are skipped', () => {
    expect(log.series.get(7)).toHaveLength(3);
  });

  test('an empty file has no series', () => {
    expect(parseLag('').series.size).toBe(0);
  });
});

describe('summariseLag gives the median p99, the worst max and the mean busy', () => {
  const rows = parseLag(TEXT).series.get(7) ?? [];

  test('the median p99 ignores the one bad second', () => {
    expect(summariseLag(rows)?.medianP99).toBe(10);
  });

  test('the worst max is the highest max of any row', () => {
    expect(summariseLag(rows)?.worstMax).toBe(300);
  });

  test('the mean busy averages the rows', () => {
    expect(summariseLag(rows)?.meanBusy).toBeCloseTo(0.2, 5);
  });

  test('no rows means nothing measured', () => {
    expect(summariseLag([])).toBeUndefined();
    expect(lagText(summariseLag([]))).toBe('not measured');
  });

  test('the words carry the three figures', () => {
    expect(lagText(summariseLag(rows))).toBe(
      'median p99 10.0ms, worst max 300.0ms, mean busy 20.0%',
    );
  });
});

describe('rowsIn keeps the rows inside a span', () => {
  const rows = parseLag(TEXT).series.get(7) ?? [];

  test('the start counts and the end does not', () => {
    expect(rowsIn(rows, { fromMs: 1000, toMs: 3000 }).map((row) => row.t)).toEqual([1000, 2000]);
  });
});

describe('formatLag prints one line per process', () => {
  test('the process that started first comes first, with its rows and span', () => {
    const lines = formatLag(parseLag(TEXT)).split('\n');
    expect(lines).toHaveLength(2);
    expect(lines[0]).toStartWith('pid 7: 3 rows over 2s: median p99 10.0ms');
    expect(lines[1]).toStartWith('pid 9: 1 rows over 0s');
  });

  test('a file without rows says how to get some', () => {
    expect(formatLag(parseLag(''))).toContain('built with --lag');
  });
});
