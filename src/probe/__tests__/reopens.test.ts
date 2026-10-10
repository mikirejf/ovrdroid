import { describe, expect, test } from 'bun:test';

import type { Reopen, ResumeMarker, UsageRow } from '../reopens.ts';
import {
  familyOf,
  findReopens,
  parseResumeAt,
  parseUsageLine,
  providerOf,
  resumeMarkersOf,
  summariseReopens,
  tallyFamilies,
} from '../reopens.ts';

const MINUTE = 60_000;
const OPUS = 'claude-opus-5-5';
const GPT = 'gpt-6-sol';
const ZONE = 'UTC';
const START = Date.parse('2026-09-18T12:00:00.000Z');

interface Row {
  session?: string;
  model?: string;
  input?: number;
  read?: number;
  write?: number;
}

function row(minute: number, spec: Row = {}): UsageRow {
  return {
    at: START + minute * MINUTE,
    sessionId: spec.session ?? 's1',
    model: spec.model ?? OPUS,
    input: spec.input ?? 2,
    cacheRead: spec.read ?? 0,
    cacheWrite: spec.write ?? 0,
  };
}

function reopensIn(usage: readonly UsageRow[], markers: readonly ResumeMarker[]): Reopen[] {
  return findReopens(usage, markers, ZONE);
}

function summaryOf(reopens: readonly Reopen[]): string {
  return summariseReopens(reopens, ZONE);
}

function marker(minute: number, session = 's1', line = 7): ResumeMarker {
  return { sessionId: session, at: START + minute * MINUTE, file: `/t/${session}.jsonl`, line };
}

function resumeLine(timestamp: string, matcher = 'resume', event = 'SessionStart'): string {
  return JSON.stringify({
    type: 'message',
    timestamp,
    message: { role: 'user', hookEventName: event, hookMatcher: matcher },
  });
}

function reopened(previous: Row, next: Row, gap: number): Reopen[] {
  return reopensIn([row(0, previous), row(gap, next)], [marker(gap - 0.5)]);
}

function only(reopens: readonly Reopen[]): Reopen {
  const [first, ...rest] = reopens;
  if (first === undefined || rest.length > 0) {
    throw new Error(`expected one reopen, got ${reopens.length}`);
  }
  return first;
}

function fresh(minute: number, spec: Row): UsageRow {
  return row(minute, { session: 'fresh', ...spec });
}

function setupChangedBy(...others: UsageRow[]): boolean {
  const rows = [row(0, { read: 30_000 }), row(20, { read: 29_940 }), ...others];
  return only(reopensIn(rows, [marker(19.5)])).setupChanged;
}

describe('a usage line is read from the log, and lines without token counts are skipped', () => {
  test('a full line parses', () => {
    const line = '{"t":5,"s":"abc","m":"gpt-6-sol","in":1,"cr":2,"cw":3,"out":4,"th":0}';

    expect(parseUsageLine(line)).toEqual({
      at: 5,
      sessionId: 'abc',
      model: 'gpt-6-sol',
      input: 1,
      cacheRead: 2,
      cacheWrite: 3,
    });
  });

  test('a promote line, a torn line and an empty line carry nothing', () => {
    expect(parseUsageLine('{"t":5,"s":"abc","m":"x","promote":true}')).toBeUndefined();
    expect(parseUsageLine('{"t":5,"s":"abc","m":"x","in":1,"cr":2')).toBeUndefined();
    expect(parseUsageLine('')).toBeUndefined();
  });
});

describe('a reopen marker is a SessionStart hook with the resume matcher', () => {
  test('the timestamp is returned', () => {
    expect(parseResumeAt(resumeLine('2026-09-18T13:20:19.126Z'))).toBe(
      Date.parse('2026-09-18T13:20:19.126Z'),
    );
  });

  test('the startup matcher, other hook events and a missing timestamp are not markers', () => {
    expect(parseResumeAt(resumeLine('2026-09-18T13:20:19.126Z', 'startup'))).toBeUndefined();
    expect(parseResumeAt(resumeLine('2026-09-18T13:20:19.126Z', 'resume', 'Stop'))).toBeUndefined();
    expect(parseResumeAt(resumeLine(''))).toBeUndefined();
    expect(parseResumeAt('not json')).toBeUndefined();
  });

  test('a transcript yields one marker per resume line, numbered from 1', () => {
    const text = [
      '{"type":"session_start","id":"s1"}',
      resumeLine('2026-09-18T12:00:00.000Z', 'startup'),
      resumeLine('2026-09-18T13:00:00.000Z'),
      '{"type":"message","message":{"role":"user"}}',
      resumeLine('2026-09-18T14:00:00.000Z'),
    ].join('\n');

    expect(resumeMarkersOf('s1', '/t/s1.jsonl', text)).toEqual([
      { sessionId: 's1', at: Date.parse('2026-09-18T13:00:00.000Z'), file: '/t/s1.jsonl', line: 3 },
      { sessionId: 's1', at: Date.parse('2026-09-18T14:00:00.000Z'), file: '/t/s1.jsonl', line: 5 },
    ]);
  });

  test('a transcript with no resume yields nothing', () => {
    expect(
      resumeMarkersOf('s1', '/t/s1.jsonl', resumeLine('2026-09-18T12:00:00Z', 'startup')),
    ).toEqual([]);
  });
});

describe('a reopen pairs the last request before the marker with the first after it', () => {
  test('the nearest rows on each side win, and other sessions are ignored', () => {
    const rows = [
      row(0, { read: 100 }),
      row(10, { input: 4, read: 800, write: 196 }),
      row(12, { session: 'other', read: 5 }),
      row(20, { read: 900 }),
      row(21, { read: 1 }),
    ];

    const reopen = only(reopensIn(rows, [marker(15)]));

    expect(reopen.previousTotal).toBe(1000);
    expect(reopen.cacheRead).toBe(900);
    expect(reopen.gapMinutes).toBe(10);
    expect(reopen.ratio).toBeCloseTo(0.9);
  });

  test('a marker with no request before it, or none after it, is dropped', () => {
    expect(reopensIn([row(5), row(10)], [marker(1)])).toEqual([]);
    expect(reopensIn([row(5), row(10)], [marker(20)])).toEqual([]);
  });

  test('two markers between the same pair of requests count once, at the first marker', () => {
    const reopens = reopensIn([row(0), row(10)], [marker(8, 's1', 9), marker(4, 's1', 3)]);

    expect(only(reopens).marker.line).toBe(3);
  });
});

describe('only gaps of 1 to 60 minutes count', () => {
  test('a gap under a minute and over an hour are left out', () => {
    expect(reopened({ read: 10 }, { read: 10 }, 0.9)).toEqual([]);
    expect(reopened({ read: 10 }, { read: 10 }, 61)).toEqual([]);
  });

  test('both edges are kept', () => {
    expect(only(reopened({ read: 10 }, { read: 10 }, 1)).gapMinutes).toBe(1);
    expect(only(reopened({ read: 10 }, { read: 10 }, 60)).gapMinutes).toBe(60);
  });
});

describe('a reopen is full, partial or none by what the next request read', () => {
  test('reading 90% of the previous total or more is full', () => {
    expect(only(reopened({ input: 0, read: 1000 }, { read: 900 }, 5)).class).toBe('full');
    expect(only(reopened({ input: 0, read: 1000 }, { read: 1200 }, 5)).class).toBe('full');
  });

  test('reading under 90% but more than 1,000 tokens is partial', () => {
    expect(only(reopened({ read: 10_000 }, { read: 8999 }, 5)).class).toBe('partial');
    expect(only(reopened({ read: 10_000 }, { read: 1001 }, 5)).class).toBe('partial');
  });

  test('reading 1,000 tokens or fewer is none', () => {
    expect(only(reopened({ read: 10_000 }, { read: 1000 }, 5)).class).toBe('none');
    expect(only(reopened({ read: 10_000 }, { read: 0 }, 5)).class).toBe('none');
  });

  test('a previous total of zero never divides by zero', () => {
    const reopen = only(reopened({ input: 0 }, { read: 0 }, 5));

    expect(reopen.ratio).toBe(0);
    expect(reopen.class).toBe('none');
  });
});

describe('a reopen is flagged when a session started then read what it read', () => {
  test('a fresh read within 500 tokens of the reopen flags it, either side', () => {
    expect(setupChangedBy(fresh(22, { read: 29_940 }))).toBe(true);
    expect(setupChangedBy(fresh(22, { read: 29_440 }))).toBe(true);
    expect(setupChangedBy(fresh(22, { read: 30_440 }))).toBe(true);
  });

  test('a fresh read 501 tokens away does not flag it', () => {
    expect(setupChangedBy(fresh(22, { read: 29_439 }))).toBe(false);
    expect(setupChangedBy(fresh(22, { read: 30_441 }))).toBe(false);
  });

  test('a fresh read far below the reopen does not flag it', () => {
    expect(setupChangedBy(fresh(22, { read: 14_241 }))).toBe(false);
  });

  test('a fresh read of 0 never flags it, even when the reopen read 0 too', () => {
    const rows = [row(0, { read: 30_000 }), row(20, { read: 0 }), fresh(22, { read: 0 })];

    expect(only(reopensIn(rows, [marker(19.5)])).setupChanged).toBe(false);
  });

  test('a fresh session of another provider does not flag it', () => {
    expect(setupChangedBy(fresh(22, { model: GPT, read: 29_940 }))).toBe(false);
  });

  test('a fresh session counts from 10 minutes before to 10 minutes after the reopen', () => {
    expect(setupChangedBy(fresh(10, { read: 29_940 }))).toBe(true);
    expect(setupChangedBy(fresh(30, { read: 29_940 }))).toBe(true);
    expect(setupChangedBy(fresh(9, { read: 29_940 }))).toBe(false);
    expect(setupChangedBy(fresh(31, { read: 29_940 }))).toBe(false);
  });

  test('only the first request of another session counts as its start', () => {
    expect(setupChangedBy(fresh(1, { read: 5000 }), fresh(22, { read: 29_940 }))).toBe(false);
  });

  test("the reopened session's own first request does not count", () => {
    const rows = [row(0, { read: 29_940 }), row(20, { read: 29_940 })];

    expect(only(reopensIn(rows, [marker(19.5)])).setupChanged).toBe(false);
  });
});

describe('model names collapse into a family and a provider', () => {
  test('versions are dropped from the family', () => {
    expect(familyOf('claude-opus-5-5')).toBe('claude-opus');
    expect(familyOf('gpt-5.6-luna')).toBe('gpt-luna');
    expect(familyOf('custom:droidproxy:gpt-6-sol')).toBe('gpt-sol');
  });

  test('claude model names, bare or prefixed, share one provider', () => {
    expect(providerOf('claude-fable-5-1')).toBe('claude');
    expect(providerOf('custom:droidproxy:opus-5-5')).toBe('claude');
    expect(providerOf('gpt-6-luna')).toBe('gpt');
  });
});

describe('the tally counts full reads and reopens per family and gap bucket', () => {
  test('each reopen lands in the bucket its gap falls in', () => {
    const reopens = [
      ...reopened({ read: 100 }, { read: 100 }, 3),
      ...reopensIn(
        [row(0, { session: 'a', read: 100 }), row(7, { session: 'a', read: 0 })],
        [marker(6, 'a')],
      ),
      ...reopensIn(
        [
          row(0, { session: 'b', model: GPT, read: 100 }),
          row(60, { session: 'b', model: GPT, read: 100 }),
        ],
        [marker(30, 'b')],
      ),
    ];

    expect(tallyFamilies(reopens)).toEqual([
      { family: 'claude-opus', full: [1, 0, 0, 0, 0], total: [1, 1, 0, 0, 0] },
      { family: 'gpt-sol', full: [0, 0, 0, 0, 1], total: [0, 0, 0, 0, 1] },
    ]);
  });
});

describe('the summary says the headline, the table and each miss in words', () => {
  const rows = [
    row(0, { session: 'aaaaaaaa-1', read: 1000 }),
    row(10, { session: 'aaaaaaaa-1', read: 950 }),
    row(0, { session: 'bbbbbbbb-2', read: 100_000 }),
    row(30, { session: 'bbbbbbbb-2', read: 0 }),
    row(28, { session: 'fresh', read: 300 }),
  ];
  const text = summaryOf(reopensIn(rows, [marker(5, 'aaaaaaaa-1'), marker(15, 'bbbbbbbb-2', 42)]));

  test('the first line counts reopens and full reads', () => {
    expect(text.split('\n')[0]).toBe('2 reopens, 1 read the full history (50.0%)');
  });

  test('the table has a row per family and an all row', () => {
    expect(text).toMatch(/claude-opus\s+-\s+-\s+1\/1\s+0\/1\s+-\s+1\/2/u);
    expect(text).toMatch(/^all {15}.*1\/2$/mu);
  });

  test('a miss names its date, short id, gap, tokens, class, setup flag and marker line', () => {
    expect(text).toContain(
      '2026-09-18  bbbbbbbb  claude-opus-5-5  gap 30.0 min  read 0 of 100,002  none',
    );
    expect(text).toContain(
      'read almost nothing; read the same as sessions started then: the setup changed since the live process started',
    );
    expect(text).toContain('/t/bbbbbbbb-2.jsonl:42');
  });

  test('a full reopen is not listed as a miss', () => {
    expect(text).not.toContain('aaaaaaaa  ');
  });

  test('misses are listed newest first', () => {
    const newest = summaryOf(
      reopensIn(
        [
          row(0, { session: 'old' }),
          row(10, { session: 'old' }),
          row(100, { session: 'new' }),
          row(110, { session: 'new' }),
        ],
        [marker(5, 'old'), marker(105, 'new')],
      ),
    );

    expect(newest.indexOf('/t/new.jsonl')).toBeLessThan(newest.indexOf('/t/old.jsonl'));
    expect(newest).not.toContain('the setup changed');
  });

  test('no misses is said plainly', () => {
    expect(summaryOf([])).toContain('reopens that missed: none');
  });
});
