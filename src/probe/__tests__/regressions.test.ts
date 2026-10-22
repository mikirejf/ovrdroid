import { describe, expect, test } from 'bun:test';

import type { Series } from '../ab.ts';
import type { IdleResult } from '../idle-report.ts';
import { idleMeasures } from '../idle-report.ts';
import type { KeysResult } from '../keys.ts';
import { keysMeasures } from '../keys.ts';
import { regressionsOf } from '../regressions.ts';
import type { ResumeRun } from '../resume-report.ts';
import { resumeMeasures } from '../resume-report.ts';
import type { StreamReading } from '../stream-report.ts';
import { streamMeasures } from '../stream-report.ts';

const STEADY = [100, 102, 98, 101];
const SLOWER = [150, 149, 152, 151];
const FASTER = [60, 61, 59, 60];
const NOISY = [60, 160, 90, 150];

function labels(measures: Parameters<typeof regressionsOf>[0]): string[] {
  return regressionsOf(measures).map(({ label }) => label);
}

describe('regressionsOf', () => {
  test('a patched series worse with the whole interval above zero is a regression', () => {
    const found = regressionsOf([
      {
        label: 'paint',
        floor: 0,
        series: [
          ['stock', STEADY],
          ['patched', SLOWER],
        ],
      },
    ]);
    expect(found.map(({ label, stock, patched }) => [label, stock, patched])).toEqual([
      ['paint', 'stock', 'patched'],
    ]);
    expect(found[0]?.meanDiff).toBeGreaterThan(40);
    expect(found[0]?.confidence).toBeCloseTo(0.95, 10);
  });

  test('a patched series better than stock passes', () => {
    expect(
      labels([
        {
          label: 'paint',
          floor: 0,
          series: [
            ['stock', STEADY],
            ['patched', FASTER],
          ],
        },
      ]),
    ).toEqual([]);
  });

  test('an interval that straddles zero passes, even with a worse mean', () => {
    expect(
      labels([
        {
          label: 'paint',
          floor: 0,
          series: [
            ['stock', [100, 100, 100, 100]],
            ['patched', NOISY],
          ],
        },
      ]),
    ).toEqual([]);
  });

  test('fewer than two rounds never resolve, so they pass', () => {
    expect(
      labels([
        {
          label: 'paint',
          floor: 0,
          series: [
            ['stock', [100]],
            ['patched', [900]],
          ],
        },
      ]),
    ).toEqual([]);
  });

  test('the first binary is stock: the order decides which side is worse', () => {
    expect(
      labels([
        {
          label: 'paint',
          floor: 0,
          series: [
            ['patched', SLOWER],
            ['stock', STEADY],
          ],
        },
      ]),
    ).toEqual([]);
  });

  test('anything but two binaries has no verdict', () => {
    const only: Series<number> = [['stock', STEADY]];
    const three: Series<number> = [
      ['a', STEADY],
      ['b', SLOWER],
      ['c', SLOWER],
    ];
    expect(labels([{ label: 'paint', series: only, floor: 0 }])).toEqual([]);
    expect(labels([{ label: 'paint', series: three, floor: 0 }])).toEqual([]);
  });

  test('names every worse measure and skips the rest', () => {
    expect(
      labels([
        {
          label: 'a',
          floor: 0,
          series: [
            ['stock', STEADY],
            ['patched', SLOWER],
          ],
        },
        {
          label: 'b',
          floor: 0,
          series: [
            ['stock', STEADY],
            ['patched', FASTER],
          ],
        },
        {
          label: 'c',
          floor: 0,
          series: [
            ['stock', STEADY],
            ['patched', SLOWER],
          ],
        },
      ]),
    ).toEqual(['a', 'c']);
  });
});

function keysRun(echoMs: number[], lagMs: number): KeysResult {
  return { echoMs, lagMs, chunks: 10 };
}

function pairOf<T>(stock: T[], patched: T[]): Series<T> {
  return [
    ['stock', stock],
    ['patched', patched],
  ];
}

const ECHO = 'echo (median per run)';

describe('keys verdict', () => {
  const stock = [0, 1, 2, 3, 4, 5].map((at) => keysRun([4 + (at % 2), 5, 5, 6, 4], 20 + at));
  const shifted = (echo: number, lag: number) =>
    stock.map((run) =>
      keysRun(
        run.echoMs.map((ms) => ms + echo),
        run.lagMs + lag,
      ),
    );

  test('slower echo alone fails', () => {
    expect(labels(keysMeasures(pairOf(stock, shifted(8, 0))))).toEqual([ECHO]);
  });

  test('more lag alone fails', () => {
    expect(labels(keysMeasures(pairOf(stock, shifted(0, 30))))).toEqual(['lag']);
  });

  test('both worse fail both', () => {
    expect(labels(keysMeasures(pairOf(stock, shifted(8, 30))))).toEqual([ECHO, 'lag']);
  });

  test('echo a millisecond slower in every run, the gate failure on 0.245.0, passes', () => {
    expect(labels(keysMeasures(pairOf(stock, shifted(1, 0))))).toEqual([]);
  });

  test('lag under one 60 Hz frame worse passes', () => {
    expect(labels(keysMeasures(pairOf(stock, shifted(0, 12))))).toEqual([]);
  });

  test('faster echo and less lag pass', () => {
    expect(labels(keysMeasures(pairOf(stock, shifted(-2, -10))))).toEqual([]);
  });

  test('one round has one sample per measure, which is not a result', () => {
    const patched = [keysRun([40, 50], 500)];
    expect(labels(keysMeasures(pairOf(stock.slice(0, 1), patched)))).toEqual([]);
  });

  test('echo is one sample per run: the median of that run, not every trial', () => {
    const [echo] = keysMeasures(
      pairOf([keysRun([4, 5, 6], 1), keysRun([10, 20], 1)], [keysRun([7, 5, 9, 8], 1)]),
    );
    expect(echo?.series).toEqual([
      ['stock', [5, 15]],
      ['patched', [7.5]],
    ]);
  });

  test('a lone slow trial in each run does not move the median', () => {
    const outliers = stock.map((run) => keysRun([...run.echoMs, 400], run.lagMs));
    expect(labels(keysMeasures(pairOf(stock, outliers)))).toEqual([]);
  });

  test('trials of one run are not counted as rounds', () => {
    const [echo] = keysMeasures(pairOf(stock, shifted(8, 0)));
    expect(echo?.series.map(([, values]) => values.length)).toEqual([6, 6]);
  });
});

function idleRun(cpuMsPerMinute: number, footprintMib: number): IdleResult {
  return {
    reading: {
      windowMs: 60_000,
      processes: [],
      cpuMsPerMinute,
      rssKib: 0,
      footprintKib: footprintMib * 1024,
      rssGrowthKibPerMinute: 0,
    },
    bytes: 0,
  };
}

describe('idle verdict', () => {
  const stock = [520, 540, 500, 530].map((cpu, at) => idleRun(cpu, 300 + at));

  test('more idle CPU alone fails', () => {
    const patched = stock.map((run) =>
      idleRun(run.reading.cpuMsPerMinute + 400, run.reading.footprintKib / 1024),
    );
    expect(labels(idleMeasures(pairOf(stock, patched)))).toEqual(['idle cpu']);
  });

  test('more memory alone fails', () => {
    const patched = stock.map((run) =>
      idleRun(run.reading.cpuMsPerMinute, run.reading.footprintKib / 1024 + 50),
    );
    expect(labels(idleMeasures(pairOf(stock, patched)))).toEqual(['idle footprint (MB)']);
  });

  test('less of both passes', () => {
    const patched = stock.map((run) =>
      idleRun(run.reading.cpuMsPerMinute - 200, run.reading.footprintKib / 1024 - 20),
    );
    expect(labels(idleMeasures(pairOf(stock, patched)))).toEqual([]);
  });

  test('a spread that swallows the difference passes', () => {
    const patched = [300, 900, 450, 800].map((cpu) => idleRun(cpu, 300));
    expect(labels(idleMeasures(pairOf(stock, patched)))).toEqual([]);
  });

  test('two rounds that disagree are too few to resolve a large mean difference', () => {
    const patched = [idleRun(1500, 900), idleRun(640, 400)];
    expect(labels(idleMeasures(pairOf(stock.slice(0, 2), patched)))).toEqual([]);
  });

  test('one round is one sample, not a result', () => {
    expect(labels(idleMeasures(pairOf(stock.slice(0, 1), [idleRun(5000, 2000)])))).toEqual([]);
  });
});

function resumeRun(at: number, overrides: Partial<ResumeRun> = {}): ResumeRun {
  return {
    paintMs: 230 + (at % 2),
    landedMs: 650 + (at % 3),
    settledMs: 800 + (at % 2),
    frames: 40,
    bytes: 260_000,
    cpuMs: 2100 + at,
    redraw: { settledMs: 500 + at, frames: 3, bytes: 290_000, cpuMs: 480 },
    ...overrides,
  };
}

describe('resume verdict', () => {
  const stock = [0, 1, 2, 3].map((at) => resumeRun(at));

  test('an identical patched build passes', () => {
    expect(
      labels(
        resumeMeasures(
          pairOf(
            stock,
            stock.map((_, at) => resumeRun(at)),
          ),
        ),
      ),
    ).toEqual([]);
  });

  test.each([
    ['input box', { paintMs: 330 }],
    ['transcript shown', { landedMs: 850 }],
    ['settled', { settledMs: 1000 }],
    ['resume cpu', { cpuMs: 2600 }],
  ] as const)('%s worse alone fails only that metric', (label, override) => {
    const patched = stock.map((_, at) => resumeRun(at, override));
    expect(labels(resumeMeasures(pairOf(stock, patched)))).toEqual([label]);
  });

  test('a slower resize redraw alone fails', () => {
    const patched = stock.map((_, at) =>
      resumeRun(at, { redraw: { settledMs: 900 + at, frames: 3, bytes: 290_000, cpuMs: 480 } }),
    );
    expect(labels(resumeMeasures(pairOf(stock, patched)))).toEqual(['resize redraw']);
  });

  test('faster everywhere passes', () => {
    const patched = stock.map((_, at) =>
      resumeRun(at, {
        paintMs: 200,
        landedMs: 500,
        settledMs: 600,
        cpuMs: 1800,
        redraw: { settledMs: 300, frames: 3, bytes: 290_000, cpuMs: 480 },
      }),
    );
    expect(labels(resumeMeasures(pairOf(stock, patched)))).toEqual([]);
  });

  test('one round is one sample, not a result', () => {
    expect(
      labels(resumeMeasures(pairOf(stock.slice(0, 1), [resumeRun(0, { cpuMs: 9000 })]))),
    ).toEqual([]);
  });
});

function streamRun(at: number, overrides: Partial<StreamReading> = {}): StreamReading {
  return {
    cpuMs: 930 + at * 3,
    wallMs: 4000,
    askMs: 50,
    lagMs: 30,
    frames: 160 + (at % 2),
    bytes: 120_000 + at * 10,
    streamMs: 2400,
    ...overrides,
  };
}

describe('stream verdict', () => {
  const stock = [0, 1, 2, 3].map((at) => streamRun(at));

  test('an identical patched build passes', () => {
    expect(
      labels(
        streamMeasures(
          pairOf(
            stock,
            stock.map((_, at) => streamRun(at)),
          ),
        ),
      ),
    ).toEqual([]);
  });

  test('more CPU alone fails', () => {
    const patched = stock.map((_, at) => streamRun(at, { cpuMs: 1300 + at * 3 }));
    expect(labels(streamMeasures(pairOf(stock, patched)))).toEqual(['stream cpu']);
  });

  test('more frames alone fails', () => {
    const patched = stock.map((_, at) => streamRun(at, { frames: 200 + (at % 2) }));
    expect(labels(streamMeasures(pairOf(stock, patched)))).toEqual(['frames']);
  });

  test('more bytes alone fails', () => {
    const patched = stock.map((_, at) => streamRun(at, { bytes: 180_000 + at * 10 }));
    expect(labels(streamMeasures(pairOf(stock, patched)))).toEqual(['bytes']);
  });

  test('less CPU, fewer frames and fewer bytes pass', () => {
    const patched = stock.map((_, at) =>
      streamRun(at, { cpuMs: 700 + at * 3, frames: 120 + (at % 2), bytes: 90_000 + at * 10 }),
    );
    expect(labels(streamMeasures(pairOf(stock, patched)))).toEqual([]);
  });

  test('a difference inside the noise passes', () => {
    const patched = [1500, 700, 1200, 800].map((cpuMs, at) => streamRun(at, { cpuMs }));
    expect(labels(streamMeasures(pairOf(stock, patched)))).toEqual([]);
  });

  test('one run is one sample, not a result', () => {
    expect(
      labels(streamMeasures(pairOf(stock.slice(0, 1), [streamRun(0, { cpuMs: 9000 })]))),
    ).toEqual([]);
  });
});
