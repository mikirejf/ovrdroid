import { describe, expect, test } from 'bun:test';

import type { CounterSample, CounterWindows } from '../counters.ts';
import {
  busiestProcess,
  parseCounters,
  span,
  summariseWindow,
  windowOf,
  windowsOf,
} from '../counters.ts';

const MICROS = 1000;

function sample(t: number, over: Partial<CounterSample> = {}): CounterSample {
  return {
    t,
    pid: 10,
    commit: 0,
    build: 0,
    frame: 0,
    frameMs: 0,
    root: 0,
    list: 0,
    md: 0,
    bytes: 0,
    cpuUser: 0,
    cpuSystem: 0,
    ...over,
  };
}

const RUN = [
  sample(1000),
  sample(1200, { commit: 3, build: 2, frame: 2, frameMs: 5, root: 1, bytes: 100 }),
  sample(1400, {
    commit: 10,
    build: 8,
    frame: 6,
    frameMs: 40,
    root: 2,
    list: 1,
    md: 4,
    bytes: 900,
    cpuUser: 30 * MICROS,
    cpuSystem: 10 * MICROS,
  }),
  sample(1600, {
    commit: 30,
    build: 20,
    frame: 12,
    frameMs: 100.5,
    root: 5,
    list: 3,
    md: 9,
    bytes: 4000,
    cpuUser: 100 * MICROS,
    cpuSystem: 20 * MICROS,
  }),
  sample(1800, {
    commit: 31,
    build: 21,
    frame: 13,
    frameMs: 103,
    root: 5,
    list: 3,
    md: 9,
    bytes: 4100,
    cpuUser: 110 * MICROS,
    cpuSystem: 20 * MICROS,
  }),
];

describe('parseCounters', () => {
  test('reads one sample per JSON line', () => {
    const text = RUN.map((entry) => JSON.stringify(entry)).join('\n');
    expect(parseCounters(text)).toEqual(RUN);
  });

  test('drops blank lines, broken JSON and rows missing a field', () => {
    const { cpuSystem: _missing, ...short } = sample(5);
    const text = ['', '{"t":', JSON.stringify(short), JSON.stringify(sample(7)), 'null'].join('\n');
    expect(parseCounters(text)).toEqual([sample(7)]);
  });

  test('drops a row whose field is not a number', () => {
    expect(parseCounters(JSON.stringify({ ...sample(5), commit: 'many' }))).toEqual([]);
  });
});

describe('windowOf', () => {
  test('subtracts the sample at the start from the sample at the end', () => {
    const window = windowOf(RUN, 1200, 1600);
    expect(window.commit).toBe(27);
    expect(window.build).toBe(18);
    expect(window.frame).toBe(10);
    expect(window.root).toBe(4);
    expect(window.list).toBe(3);
    expect(window.md).toBe(9);
    expect(window.bytes).toBe(3900);
    expect(window.frameMs).toBeCloseTo(95.5);
    expect(window.spanMs).toBe(400);
  });

  test('turns CPU microseconds into milliseconds, user plus system', () => {
    expect(windowOf(RUN, 1200, 1600).cpuMs).toBe(120);
  });

  test('widens the window to the samples around it, and says how wide it got', () => {
    const window = windowOf(RUN, 1250, 1550);
    expect(window.spanMs).toBe(400);
    expect(window.commit).toBe(27);
  });

  test('a window past the last sample ends at the last sample', () => {
    expect(windowOf(RUN, 1600, 9000).commit).toBe(1);
  });

  test('a window before the first sample starts at the first sample', () => {
    expect(windowOf(RUN, 0, 1200).commit).toBe(3);
  });

  test('refuses a window that ends before it starts', () => {
    expect(() => windowOf(RUN, 1600, 1200)).toThrow('before it starts');
  });

  test('refuses fewer than two samples', () => {
    expect(() => windowOf([sample(1)], 0, 10)).toThrow('at least two samples');
  });

  test('refuses samples from two processes', () => {
    const mixed = [sample(1), sample(2, { pid: 11 })];
    expect(() => windowOf(mixed, 0, 10)).toThrow('2 processes');
  });
});

describe('busiestProcess', () => {
  test('keeps the process that wrote the most samples', () => {
    const mixed = [sample(1, { pid: 11 }), sample(2), sample(3), sample(4, { pid: 11 }), sample(5)];
    expect(busiestProcess(mixed).map((entry) => entry.t)).toEqual([2, 3, 5]);
  });

  test('an empty file yields no samples', () => {
    expect(busiestProcess([])).toEqual([]);
  });
});

describe('summariseWindow', () => {
  test('names every counter in plain words', () => {
    const line = summariseWindow(windowOf(RUN, 1200, 1600));
    expect(line).toBe(
      '27 commits, 10 frames written (18 built), 4 root renders, 3 message list renders, 9 markdown parses, 95.5 ms building frames, 3900 bytes to the terminal, 120 ms of CPU in 400 ms',
    );
  });

  test('uses the singular for one', () => {
    const line = summariseWindow(windowOf(RUN, 1600, 1800));
    expect(line).toContain('1 commit,');
    expect(line).toContain('1 frame written');
    expect(line).toContain('0 root renders');
  });
});

describe('span', () => {
  test('moves probe milliseconds onto the wall clock the counters use', () => {
    const moved = span(100, 250);
    expect(moved.from).toBe(performance.timeOrigin + 100);
    expect(moved.to - moved.from).toBe(150);
  });
});

function commitsIn(windows: CounterWindows | undefined, name: string): number | undefined {
  return windows?.[name]?.commit;
}

describe('windowsOf', () => {
  const text = RUN.map((entry) => JSON.stringify(entry)).join('\n');

  test('cuts one window per named span', () => {
    const windows = windowsOf(text, {
      early: { from: 1000, to: 1200 },
      late: { from: 1600, to: 1800 },
    });
    expect(commitsIn(windows, 'early')).toBe(3);
    expect(commitsIn(windows, 'late')).toBe(1);
  });

  test('a file with no samples means the binary has no counters', () => {
    expect(windowsOf('', { all: { from: 0, to: 10 } })).toBeUndefined();
    expect(windowsOf('not json', { all: { from: 0, to: 10 } })).toBeUndefined();
  });

  test('reads the busiest process when children write to the same file', () => {
    const mixed = [...RUN, sample(1100, { pid: 99, commit: 500 })];
    const windows = windowsOf(mixed.map((entry) => JSON.stringify(entry)).join('\n'), {
      all: { from: 1000, to: 1800 },
    });
    expect(commitsIn(windows, 'all')).toBe(31);
  });
});
