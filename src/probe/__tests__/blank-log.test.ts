import { describe, expect, test } from 'bun:test';

import { describeBlankLog, parseBlankLog, parseSince } from '../blank-log.ts';

const BASE = Date.parse('2026-11-07T00:12:00.000Z');

type Extra = Readonly<Record<string, string | number | boolean>>;

function line(offsetMs: number, event: string, extra: Extra = {}): string {
  return JSON.stringify({
    t: new Date(BASE + offsetMs).toISOString(),
    pid: 42,
    event,
    sid: 'tui-session',
    agentScope: null,
    ...extra,
  });
}

function story(...lines: string[]): string[] {
  return describeBlankLog(parseBlankLog(lines.join('\n')));
}

describe('parseBlankLog', () => {
  test('rows come back in time order with their extra fields as detail, and torn lines are counted', () => {
    const log = parseBlankLog(
      [
        line(2000, 'static-reset', { kind: 'clear' }),
        '{"t":',
        line(1000, 'compaction', { phase: 'start' }),
        '',
      ].join('\n'),
    );
    expect(log.unreadable).toBe(1);
    expect(log.rows.map((row) => row.event)).toEqual(['compaction', 'static-reset']);
    expect([...(log.rows[1]?.detail ?? [])]).toEqual([['kind', 'clear']]);
  });
});

describe('parseSince', () => {
  test('a duration counts back from now, and a date is taken as it is', () => {
    expect(parseSince('30m', BASE)).toBe(BASE - 1_800_000);
    expect(parseSince('2026-11-07T00:00:00Z', BASE)).toBe(Date.parse('2026-11-07T00:00:00Z'));
  });

  test('anything else is refused', () => {
    expect(() => parseSince('yesterday-ish', BASE)).toThrow('--since');
  });
});

describe('describeBlankLog', () => {
  test('a clear for a retracted segment inside an agent scope during compaction reads as one sentence', () => {
    const lines = story(
      line(0, 'compaction', { phase: 'start', path: 'agent', target: 'tui-session' }),
      line(9000, 'scoped-read', { agentScope: 'agent-1' }),
      line(11_000, 'epoch-reset', { reason: 'retracted-segment' }),
      line(12_000, 'static-reset', {
        agentScope: 'agent-1',
        kind: 'rebuild',
        cause: 'retracted-segment',
        stack: 'at D5e (/$bunfs/root/chunk-a.js:1:2)\nat d4 (/$bunfs/root/chunk-b.js:1:9)',
      }),
      line(20_000, 'compaction', { phase: 'end', path: 'agent', outcome: 'succeeded' }),
    );
    expect(lines[1]).toBe(
      '00:12:12.000 pid 42: the terminal was cleared and the history reprinted for retracted-segment, ' +
        'while an agent scope (session agent-1) was active, ' +
        'during the agent compaction for session tui-session started 12.0s earlier; ' +
        'in the 5s before: 1 scoped read of a session the agent adapter lacks, an epoch reset for retracted-segment; ' +
        'stack top: at D5e (/$bunfs/root/chunk-a.js:1:2) < at d4 (/$bunfs/root/chunk-b.js:1:9)',
    );
  });

  test('an empty render names the counts, effort and working state it saw', () => {
    const lines = story(
      line(0, 'empty-render', {
        previous: 812,
        managerFound: false,
        effort: 'medium',
        working: 'idle',
      }),
    );
    expect(lines[1]).toBe(
      '00:12:00.000 pid 42: the message list of session tui-session went from 812 messages to 0 ' +
        '(session manager missing, effort medium, working state idle), outside any agent scope, with no compaction running',
    );
  });

  test('a clear shortly after a compaction ended says how long after, and an unknown cause says so', () => {
    const lines = story(
      line(0, 'compaction', { phase: 'start', path: 'manual' }),
      line(1000, 'compaction', { phase: 'end', path: 'manual', outcome: 'failed' }),
      line(4000, 'static-reset', { kind: 'clear', cause: 'unattributed' }),
    );
    expect(lines[1]).toContain('with no recorded cause');
    expect(lines[1]).toContain('3.0s after a manual compaction ended (failed)');
  });

  test('context older than five seconds is left out', () => {
    const lines = story(
      line(0, 'session-drop', { via: 'removeSession', target: 'old' }),
      line(6000, 'static-reset', { kind: 'clear-reset', cause: 'resize:repaintTranscript' }),
    );
    expect(lines[1]).not.toContain('session drop');
    expect(lines[1]).toContain('static output reset');
    expect(lines[1]).toContain('for resize:repaintTranscript');
  });

  test('the summary counts every kind, and a quiet log says nothing blanked', () => {
    const lines = story(
      line(0, 'compaction', { phase: 'start', path: 'agent' }),
      line(1, 'scoped-read'),
      line(2, 'session-drop', { via: 'evictCachedSession' }),
    );
    expect(lines[0]).toContain(
      '3 log lines from 2026-11-07T00:12:00.000Z to 2026-11-07T00:12:00.002Z: 0 empty renders, 0 terminal clears',
    );
    expect(lines[0]).toContain('1 scoped reads, 1 session drops, 1 compactions started');
    expect(lines[1]).toBe('No empty render or terminal clear was logged in this window.');
  });
});
