import { describe, expect, test } from 'bun:test';

import { megabytes } from '../../cli.ts';
import { formatIdle, parseCpuTime, parsePs, readIdle } from '../idle.ts';

describe('parseCpuTime reads every shape ps prints', () => {
  test('minutes, seconds and hundredths', () => {
    expect(parseCpuTime('0:01.50')).toBe(1500);
    expect(parseCpuTime('2:00.00')).toBe(120_000);
  });

  test('an hours field appears once a process is old enough', () => {
    expect(parseCpuTime('1:00:00.00')).toBe(3_600_000);
  });

  test('a days field appears on a long-lived process', () => {
    expect(parseCpuTime('1-00:00:00.00')).toBe(86_400_000);
  });

  test('the hundredths are optional', () => {
    expect(parseCpuTime('0:07')).toBe(7000);
  });

  test('junk is rejected rather than read as zero', () => {
    expect(parseCpuTime('TIME')).toBeUndefined();
    expect(parseCpuTime('')).toBeUndefined();
  });
});

describe('parsePs turns the listing into samples', () => {
  test('user and system time are summed', () => {
    const [sample] = parsePs('  100   0:01.00   0:00.50   4096', 0);
    expect(sample?.pid).toBe(100);
    expect(sample?.cpuMs).toBe(1500);
    expect(sample?.rssKib).toBe(4096);
  });

  test('a header line is skipped rather than parsed', () => {
    expect(parsePs('  PID     UTIME     STIME    RSS', 0)).toEqual([]);
  });
});

const WINDOW = [
  ...parsePs('100  0:01.00  0:00.00  1024\n200  0:00.50  0:00.00  2048', 0),
  ...parsePs('100  0:02.00  0:00.00  2048\n200  0:00.50  0:00.00  2048', 30_000),
];

const NAMES = new Map([
  [100, 'droid'],
  [200, 'droid exec --input-format stream-jsonrpc'],
]);

const FOOTPRINTS = new Map([
  [100, 900],
  [200, 800],
]);

const INPUTS = { names: NAMES, footprints: FOOTPRINTS };

describe('readIdle charges cost per minute, not per window', () => {
  const reading = readIdle(WINDOW, INPUTS);

  test('each process is named, so a cost can be blamed on something', () => {
    expect(reading.processes.at(0)?.command).toBe('droid');
  });

  test('the window is the span actually sampled', () => {
    expect(reading.windowMs).toBe(30_000);
  });

  test('a half-minute window doubles into a per-minute rate', () => {
    expect(reading.cpuMsPerMinute).toBe(2000);
  });

  test('a process that burned nothing is charged nothing', () => {
    const quiet = reading.processes.find((cost) => cost.pid === 200);
    expect(quiet?.cpuMsPerMinute).toBe(0);
  });

  test('resident memory is the last reading, not the sum over time', () => {
    expect(reading.rssKib).toBe(4096);
  });

  test('footprint is tracked apart from rss, because rss counts the shared binary twice', () => {
    expect(reading.footprintKib).toBe(1700);
    expect(reading.footprintKib).toBeLessThan(reading.rssKib);
  });

  test('a process vmmap could not read is charged no footprint rather than guessed', () => {
    expect(readIdle(WINDOW, { names: NAMES }).footprintKib).toBe(0);
  });

  test('growth is reported per minute too', () => {
    expect(reading.rssGrowthKibPerMinute).toBe(2048);
  });

  test('the busiest process sorts first', () => {
    expect(reading.processes.at(0)?.pid).toBe(100);
  });
});

describe('readIdle refuses to invent a rate', () => {
  test('one sample of a process is not a rate, so it is dropped', () => {
    const reading = readIdle(parsePs('100  0:01.00  0:00.00  1024', 0));
    expect(reading.processes).toEqual([]);
    expect(reading.cpuMsPerMinute).toBe(0);
  });

  test('an empty listing yields zeroes rather than NaN', () => {
    const reading = readIdle([]);
    expect([reading.windowMs, reading.cpuMsPerMinute, reading.rssKib]).toEqual([0, 0, 0]);
  });
});

describe('the report reads as plain text', () => {
  test('megabytes are printed, not raw kibibytes', () => {
    expect(megabytes(2048)).toBe('2.0 MB');
  });

  test('every process gets a line and the totals are named', () => {
    const text = formatIdle(readIdle(WINDOW, INPUTS), 512);
    expect(text).toContain('2000ms per minute of standing by');
    expect(text).toContain('512 bytes');
    expect(text).toContain('droid exec');
    expect(text.split('\n').filter((line) => line.includes('ms/min'))).toHaveLength(2);
  });

  test('the report says which memory number caps parallel sessions', () => {
    expect(formatIdle(readIdle(WINDOW, INPUTS), 0)).toContain('caps parallel sessions');
  });

  test('a process ps never named is still reported, not dropped', () => {
    expect(formatIdle(readIdle(WINDOW), 0)).toContain('unknown');
  });
});
