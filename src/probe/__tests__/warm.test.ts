import { describe, expect, test } from 'bun:test';

import type { WarmRun } from '../warm-verdict.ts';
import {
  cacheLabelOf,
  describeChecks,
  labelBefore,
  warmChecks,
  warmLinesOf,
  warmPassed,
} from '../warm-verdict.ts';

const SENT = 1_000_000;
const DELAY = 90_000;

const WARM = { at: SENT + 97_000, ok: true, kids: 1, cacheRead: 24_347, cacheWrite: 0 };

function passing(): WarmRun {
  return {
    delayMs: DELAY,
    launch: { input: 3, cacheRead: 23_748, cacheWrite: 599 },
    launchSentAt: SENT,
    childRunning: true,
    warm: WARM,
    next: { input: 3, cacheRead: 24_347, cacheWrite: 28 },
    labels: {
      afterLaunch: 'cache 44m',
      beforeWarm: 'cache 43m',
      afterWarm: 'cache 44m',
      afterNext: 'cache 44m',
    },
  };
}

function failures(run: WarmRun): string[] {
  return warmChecks(run)
    .filter((entry) => !entry.pass)
    .map((entry) => entry.text);
}

describe('warmChecks passes a run where the warmer kept the cache and the clock followed it', () => {
  test('every check passes on the live numbers', () => {
    const checks = warmChecks(passing());
    expect(warmPassed(checks)).toBe(true);
    expect(describeChecks(checks).split('\n')[0]).toBe(
      'pass  the warm request fired 97s after the launch prompt (delay 90s), with 1 sub-agent(s) running',
    );
  });
});

describe('warmChecks fails when the warm request did not do its job', () => {
  test('no warm with the sub-agent running means the warmer never fired', () => {
    expect(failures({ ...passing(), warm: undefined })).toContain(
      'no warm request fired after 90s idle with a sub-agent running',
    );
  });

  test('no warm after the sub-agent finished means the run did not exercise the warmer', () => {
    expect(failures({ ...passing(), warm: undefined, childRunning: false })).toContain(
      'the sub-agent finished before the 90s idle delay was up, so the run did not exercise the warmer',
    );
  });

  test('a warm logged before the delay was up fails', () => {
    const early = passing();
    early.warm = { ...WARM, at: SENT + 30_000 };
    expect(failures(early)).toEqual([
      'the warm request fired 30s after the launch prompt, before the 90s delay',
    ]);
  });

  test('a warm that failed or was aborted fails', () => {
    const aborted = passing();
    aborted.warm = { ...WARM, ok: false };
    expect(failures(aborted)).toEqual([
      'the warm request fired 97s after the launch prompt but failed or was aborted',
    ]);
  });

  test('a warm that read under 90% of the prefix did not match the request', () => {
    const missed = passing();
    missed.warm = { ...WARM, cacheRead: 6000, cacheWrite: 18_347 };
    expect(failures(missed)).toEqual([
      "the warm request read only 6,000 of the 24,347-token cached prefix and wrote 18,347: it did not match the session's request",
    ]);
  });

  test('a launch turn that cached nothing cannot judge the warm', () => {
    const empty = { ...passing(), launch: { input: 24_000, cacheRead: 0, cacheWrite: 0 } };
    expect(failures(empty)).toContain(
      'the launch turn cached nothing, so the run cannot judge the warm',
    );
  });

  test('a next turn that re-wrote the prefix fails', () => {
    expect(
      failures({ ...passing(), next: { input: 3, cacheRead: 0, cacheWrite: 24_375 } }),
    ).toEqual(['the next turn read only 0 of the 24,347-token prefix and wrote 24,375']);
  });
});

describe('warmChecks fails when the footer clock is wrong', () => {
  test('no label at all fails every label check', () => {
    const blank = {
      ...passing(),
      labels: {
        afterLaunch: undefined,
        beforeWarm: undefined,
        afterWarm: undefined,
        afterNext: undefined,
      },
    };
    expect(failures(blank)).toHaveLength(4);
  });

  test('a clock that did not count down before the warm fails', () => {
    const stuck = passing();
    stuck.labels = { ...stuck.labels, beforeWarm: 'cache 44m' };
    expect(failures(stuck)).toContain(
      'just before the warm was due it showed "cache 44m", not a countdown below "cache 44m"',
    );
  });

  test('a clock that ignored the warm fails', () => {
    const ignored = passing();
    ignored.labels = { ...ignored.labels, afterWarm: 'cache 43m' };
    expect(failures(ignored)).toEqual([
      'after the warm it showed "cache 43m": the clock did not take the warm',
    ]);
  });

  test('a cold label after the next turn fails', () => {
    const cold = passing();
    cold.labels = { ...cold.labels, afterNext: 'cache cold' };
    expect(failures(cold)).toEqual(['after the next turn it showed "cache cold", not "cache 44m"']);
  });
});

describe('warmLinesOf reads the warm rows of one session from cache-usage.jsonl', () => {
  test('it keeps warm rows of the session and skips the rest', () => {
    const body = [
      '{"t":1,"s":"a","m":"x","in":3,"cr":0,"cw":100,"out":1}',
      '{"t":2,"s":"a","m":"x","warm":true,"kids":1,"ok":true,"in":3,"cr":100,"cw":0,"out":1}',
      '{"t":3,"s":"b","m":"x","warm":true,"kids":1,"ok":true,"in":3,"cr":50,"cw":0,"out":1}',
      'not json',
      '',
    ].join('\n');
    expect(warmLinesOf(body, 'a')).toEqual([
      { at: 2, ok: true, kids: 1, cacheRead: 100, cacheWrite: 0 },
    ]);
  });

  test('a failed warm with no usage reads as zero', () => {
    expect(warmLinesOf('{"t":5,"s":"a","warm":true,"kids":2,"ok":false}', 'a')).toEqual([
      { at: 5, ok: false, kids: 2, cacheRead: 0, cacheWrite: 0 },
    ]);
  });
});

describe('cacheLabelOf finds the cache clock in a footer frame', () => {
  test.each([
    ['[medium], ↑1m ↓<1m, cache 43m]', 'cache 43m'],
    ['↓2m, cache <1m', 'cache <1m'],
    ['↓50m, cache cold', 'cache cold'],
    ['cache cold: skills, mcp changed', 'cache cold: skills, mcp changed'],
    ['cache checking', 'cache checking'],
  ])('%s', (frame, label) => {
    expect(cacheLabelOf(frame)).toBe(label);
  });

  test('a frame without the clock has no label', () => {
    expect(cacheLabelOf('│ > type here')).toBeUndefined();
  });
});

describe('labelBefore takes the last label seen before a time', () => {
  const samples = [
    { at: 10, label: 'cache 44m' },
    { at: 20, label: 'cache 43m' },
    { at: 30, label: 'cache 44m' },
  ];

  test('it ignores samples at or after the time', () => {
    expect(labelBefore(samples, 30)).toBe('cache 43m');
  });

  test('nothing before the first sample is undefined', () => {
    expect(labelBefore(samples, 10)).toBeUndefined();
  });
});
