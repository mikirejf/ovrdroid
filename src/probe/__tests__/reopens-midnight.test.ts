import { describe, expect, test } from 'bun:test';

import type { Reopen, ResumeMarker, UsageRow } from '../reopens.ts';
import { causeOf, findReopens, summariseReopens } from '../reopens.ts';

const LJUBLJANA = 'Europe/Ljubljana';
const OPUS = 'claude-opus-5-5';

interface Row {
  session?: string;
  read?: number;
  model?: string;
}

function usageAt(iso: string, spec: Row = {}): UsageRow {
  return {
    at: Date.parse(iso),
    sessionId: spec.session ?? 's1',
    model: spec.model ?? OPUS,
    input: 2,
    cacheRead: spec.read ?? 0,
    cacheWrite: 0,
  };
}

function markerAt(iso: string, session = 's1'): ResumeMarker {
  return { sessionId: session, at: Date.parse(iso), file: `/t/${session}.jsonl`, line: 7 };
}

function only(reopens: readonly Reopen[]): Reopen {
  const [first, ...rest] = reopens;
  if (first === undefined || rest.length > 0) {
    throw new Error(`expected one reopen, got ${reopens.length}`);
  }
  return first;
}

function crossing(previous: string, next: string, zone: string): Reopen {
  const middle = new Date((Date.parse(previous) + Date.parse(next)) / 2).toISOString();
  return only(findReopens([usageAt(previous), usageAt(next)], [markerAt(middle)], zone));
}

describe('a reopen is flagged when it crossed midnight in the given time zone', () => {
  test('23:59 and 00:01 local are on different days', () => {
    const reopen = crossing('2026-09-30T21:59:00Z', '2026-09-30T22:01:00Z', LJUBLJANA);

    expect(reopen.crossedMidnight).toBe(true);
    expect(causeOf(reopen)).toBe('crossed midnight');
  });

  test('the same two instants are one day in UTC', () => {
    expect(crossing('2026-09-30T21:59:00Z', '2026-09-30T22:01:00Z', 'UTC').crossedMidnight).toBe(
      false,
    );
  });

  test('a pair that straddles UTC midnight but not local midnight is not flagged', () => {
    const reopen = crossing('2026-09-30T23:30:00Z', '2026-10-01T00:30:00Z', LJUBLJANA);

    expect(reopen.crossedMidnight).toBe(false);
    expect(causeOf(reopen)).toBe('unexplained');
  });

  test('a pair on one local day is not flagged', () => {
    expect(
      crossing('2026-09-30T10:00:00Z', '2026-09-30T10:20:00Z', LJUBLJANA).crossedMidnight,
    ).toBe(false);
  });

  test('a GPT pair across local midnight is not flagged, the date note is a Claude proxy step', () => {
    const rows = [
      usageAt('2026-09-30T21:59:00Z', { model: 'gpt-6-sol' }),
      usageAt('2026-09-30T22:01:00Z', { model: 'gpt-6-sol' }),
    ];
    const reopens = findReopens(rows, [markerAt('2026-09-30T22:00:00Z')], LJUBLJANA);

    expect(only(reopens).crossedMidnight).toBe(false);
  });

  test('crossing midnight outranks a setup change in the cause and the note', () => {
    const rows = [
      usageAt('2026-09-30T21:50:00Z', { read: 100_000 }),
      usageAt('2026-09-30T22:10:00Z', { read: 9594 }),
      usageAt('2026-09-30T22:12:00Z', { read: 9600, session: 'fresh' }),
    ];
    const reopens = findReopens(rows, [markerAt('2026-09-30T22:00:00Z')], LJUBLJANA);
    const text = summariseReopens(reopens, LJUBLJANA);

    expect(only(reopens).setupChanged).toBe(true);
    expect(causeOf(only(reopens))).toBe('crossed midnight');
    expect(text).toContain(
      "crossed local midnight: the proxy's date note changed, so the history after it was rewritten",
    );
    expect(text).not.toContain('the setup changed since');
  });
});

describe('the summary counts misses by cause', () => {
  test('each miss is counted once, midnight first, then setup, then the rest', () => {
    const rows = [
      usageAt('2026-09-30T21:50:00Z', { read: 100_000, session: 'mid' }),
      usageAt('2026-09-30T22:10:00Z', { read: 0, session: 'mid' }),
      usageAt('2026-09-24T10:00:00Z', { read: 100_000, session: 'set' }),
      usageAt('2026-09-24T10:20:00Z', { read: 9594, session: 'set' }),
      usageAt('2026-09-24T10:22:00Z', { read: 9600, session: 'fresh' }),
      usageAt('2026-09-25T10:00:00Z', { read: 100_000, session: 'odd' }),
      usageAt('2026-09-25T10:20:00Z', { read: 40_000, session: 'odd' }),
    ];
    const markers = [
      markerAt('2026-09-30T22:00:00Z', 'mid'),
      markerAt('2026-09-24T10:10:00Z', 'set'),
      markerAt('2026-09-25T10:10:00Z', 'odd'),
    ];
    const text = summariseReopens(findReopens(rows, markers, LJUBLJANA), LJUBLJANA);

    expect(text.split('\n')[1]).toBe(
      'misses by cause: crossed midnight 1, setup changed 1, unexplained 1',
    );
  });

  test('no misses counts zeros', () => {
    expect(summariseReopens([], LJUBLJANA).split('\n')[1]).toBe(
      'misses by cause: crossed midnight 0, setup changed 0, unexplained 0',
    );
  });
});
