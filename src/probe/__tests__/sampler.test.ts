import { describe, expect, test } from 'bun:test';

import type { Tick, TreeProcess } from '../sampler.ts';
import {
  busiestWindow,
  cpuSeries,
  formatSummary,
  parseSamples,
  readTick,
  serialiseFootprints,
  serialiseTick,
  summariseTicks,
  threadCount,
  withFootprints,
} from '../sampler.ts';

function fail(): never {
  throw new Error('expected a summary');
}

const LISTING = [
  '  PID  PPID     UTIME     STIME    RSS COMMAND',
  '  100     1   0:10.00   0:02.00 300000 /Users/me/.local/bin/droid --auto high',
  '  101   100   0:00.50   0:00.50  20000 /opt/bin/rg --files',
  '  102   101   0:00.10   0:00.00   5000 /bin/sh -c sleep 30',
  '  200     1   9:00.00   1:00.00 900000 /Applications/Other.app/other',
].join('\n');

interface ProcOptions {
  cpuMs: number;
  rssKib: number;
  footprintKib?: number;
}

function proc(pid: number, options: ProcOptions): TreeProcess {
  return {
    pid,
    ppid: pid === 100 ? 1 : 100,
    cpuMs: options.cpuMs,
    rssKib: options.rssKib,
    command: pid === 100 ? 'droid' : 'rg',
    ...(options.footprintKib !== undefined && { footprintKib: options.footprintKib }),
  };
}

function tick(atMs: number, processes: TreeProcess[], threads = 20): Tick {
  return { atMs, root: 100, threads, processes };
}

describe('readTick keeps the tree of the root and nothing else', () => {
  const tree = readTick(LISTING, { root: 100, atMs: 5000, threads: 21 });

  test('children and grandchildren are included', () => {
    expect(tree?.processes.map((entry) => entry.pid)).toEqual([100, 101, 102]);
  });

  test('user and system time are summed', () => {
    expect(tree?.processes[0]?.cpuMs).toBe(12_000);
  });

  test('commands are shortened to the program name', () => {
    expect(tree?.processes[1]?.command).toBe('rg --files');
  });

  test('a root that is gone yields no tick', () => {
    expect(readTick(LISTING, { root: 999, atMs: 0, threads: 0 })).toBeUndefined();
  });
});

describe('threadCount', () => {
  test('counts every row under the header', () => {
    expect(threadCount('USER PID\nme 100\nme 100\nme 100\n')).toBe(3);
  });

  test('a process that is gone has no threads', () => {
    expect(threadCount('')).toBe(0);
  });
});

describe('the sample file round-trips with footprints joined to their tick', () => {
  const first = tick(1000, [proc(100, { cpuMs: 0, rssKib: 1000 })]);
  const second = tick(2000, [proc(100, { cpuMs: 10, rssKib: 1100 })]);
  const text = [
    serialiseTick(second),
    serialiseTick(first),
    serialiseFootprints(1000, new Map([[100, 4096]])),
    'junk',
  ].join('\n');
  const ticks = parseSamples(text);

  test('ticks come back in time order', () => {
    expect(ticks.map((entry) => entry.atMs)).toEqual([1000, 2000]);
  });

  test('a footprint record lands on the tick with the same time', () => {
    expect(ticks[0]?.processes[0]?.footprintKib).toBe(4096);
    expect(ticks[1]?.processes[0]?.footprintKib).toBeUndefined();
  });

  test('withFootprints leaves unmeasured processes alone', () => {
    const merged = withFootprints(first, new Map());
    expect(merged.processes[0]?.footprintKib).toBeUndefined();
  });
});

describe('summariseTicks reports memory, cpu, threads and children', () => {
  const ticks = [
    tick(0, [proc(100, { cpuMs: 0, rssKib: 300_000, footprintKib: 400_000 })], 20),
    tick(1000, [proc(100, { cpuMs: 1000, rssKib: 310_000 })], 20),
    tick(
      2000,
      [proc(100, { cpuMs: 3000, rssKib: 800_000 }), proc(101, { cpuMs: 500, rssKib: 20_000 })],
      40,
    ),
    tick(
      3000,
      [proc(100, { cpuMs: 4000, rssKib: 450_000 }), proc(101, { cpuMs: 800, rssKib: 20_000 })],
      30,
    ),
    tick(4000, [proc(100, { cpuMs: 4200, rssKib: 440_000, footprintKib: 420_000 })], 25),
  ];
  const summary = summariseTicks(ticks);

  test('memory has a baseline, a peak with its time, and an end', () => {
    expect(summary?.rootRss).toEqual({
      baseline: 300_000,
      peak: 800_000,
      peakT: 2000,
      end: 440_000,
    });
  });

  test('the footprint is read from the ticks that carry one', () => {
    expect(summary?.rootFootprint?.baseline).toBe(400_000);
    expect(summary?.rootFootprint?.end).toBe(420_000);
  });

  test('the tree counts children that came and went', () => {
    expect(summary?.treeRss.peak).toBe(820_000);
  });

  test('the parent cpu is the root process alone', () => {
    expect(summary?.parentCpu.cpuSeconds).toBeCloseTo(4.2, 5);
  });

  test('the child cpu is every other process, and keeps one that exited after its last sighting', () => {
    expect(summary?.childCpu.cpuSeconds).toBeCloseTo(0.8, 5);
  });

  test('average cores is cpu over the window, for each part', () => {
    expect(summary?.parentCpu.averageCores).toBeCloseTo(1.05, 5);
    expect(summary?.childCpu.averageCores).toBeCloseTo(0.2, 5);
  });

  test('the busiest stretch is found for each part', () => {
    expect(summary?.parentCpu.busiest.cores).toBeCloseTo(1.05, 5);
    expect(summary?.childCpu.busiest.cores).toBeCloseTo(0.2, 5);
  });

  test('threads peak at the busiest tick', () => {
    expect(summary?.threads.peak).toBe(40);
  });

  test('the children are named at their peak', () => {
    expect(summary?.peakChildren).toBe(1);
    expect(summary?.childNames).toEqual(['rg']);
  });

  test('a longer baseline averages the early ticks', () => {
    expect(summariseTicks(ticks, { baselineMs: 1000 })?.rootRss.baseline).toBe(305_000);
  });

  test('no ticks means no summary', () => {
    expect(summariseTicks([])).toBeUndefined();
  });

  test('the words say what happened', () => {
    const text = formatSummary(summary ?? fail());
    expect(text).toContain('rose');
    expect(text).toContain('children: at most 1 child processes at once: rg');
    expect(text).toContain(
      'cpu of the parent process: 4.2 cpu-seconds in 4.0s, 1.05 cores on average',
    );
    expect(text).toContain(
      'cpu of the child processes (every descendant, shell commands included): 0.8 cpu-seconds in 4.0s, 0.20 cores on average',
    );
  });

  test('a run without children says so', () => {
    const alone = summariseTicks([
      tick(0, [proc(100, { cpuMs: 0, rssKib: 100 })]),
      tick(1000, [proc(100, { cpuMs: 10, rssKib: 100 })]),
    ]);
    const text = formatSummary(alone ?? fail());
    expect(text).toContain('no child process at any time');
    expect(text).toContain('cpu of the parent process');
    expect(text).not.toContain('cpu of the child processes');
  });
});

describe('cpuSeries keeps the parent apart from its children', () => {
  const ticks = [
    tick(0, [proc(100, { cpuMs: 100, rssKib: 1 }), proc(101, { cpuMs: 50, rssKib: 1 })]),
    tick(1000, [proc(100, { cpuMs: 400, rssKib: 1 }), proc(101, { cpuMs: 80, rssKib: 1 })]),
    tick(2000, [
      proc(100, { cpuMs: 500, rssKib: 1 }),
      proc(101, { cpuMs: 90, rssKib: 1 }),
      proc(102, { cpuMs: 30, rssKib: 1 }),
    ]),
  ];

  test('the parent series counts only the root', () => {
    expect(cpuSeries(ticks, 'parent').map((point) => point.value)).toEqual([0, 300, 400]);
  });

  test('the child series starts a new child from zero', () => {
    expect(cpuSeries(ticks, 'children').map((point) => point.value)).toEqual([0, 30, 70]);
  });
});

describe('busiestWindow finds the hottest stretch', () => {
  const cpu = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((second) => ({
    t: second * 1000,
    value: second < 6 ? second * 100 : 500 + (second - 5) * 1000,
  }));

  test('it starts where the cpu jumps', () => {
    const busiest = busiestWindow(cpu);
    expect(busiest.fromMs).toBe(5000);
    expect(busiest.cores).toBeCloseTo(1, 5);
  });

  test('a window shorter than five seconds falls back to the whole span', () => {
    const busiest = busiestWindow(cpu.slice(0, 3));
    expect(busiest.fromMs).toBe(0);
    expect(busiest.cores).toBeCloseTo(0.1, 5);
  });

  test('nothing in, nothing out', () => {
    expect(busiestWindow([])).toEqual({ cores: 0, fromMs: 0 });
  });
});
