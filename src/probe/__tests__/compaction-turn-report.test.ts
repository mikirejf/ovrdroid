import { describe, expect, test } from 'bun:test';

import type { BodyRow, JsonObject } from '../bodies.ts';
import {
  compactionTurnVerdict,
  describeRequests,
  markerPaths,
  nextTurnPairing,
} from '../compaction-turn-report.ts';
import type { UsageLine } from '../logs.ts';

const MARK = { type: 'ephemeral' };

function row(t: number, body: JsonObject): BodyRow {
  return { t, sessionId: 's', assistantMessageId: `m${t}`, route: 'anthropic', body };
}

const FIRST: JsonObject = {
  system: [{ type: 'text', text: 'sys', cache_control: MARK }],
  messages: [
    { role: 'user', content: [{ type: 'text', text: 'summary', cache_control: MARK }] },
    { role: 'assistant', content: [{ type: 'text', text: 'ok', cache_control: MARK }] },
  ],
};

describe('markerPaths', () => {
  test('lists every cache marker by path', () => {
    expect(markerPaths(FIRST)).toEqual([
      'system[0]',
      'messages[0].content[0]',
      'messages[1].content[0]',
    ]);
  });
});

describe('the request after the next user message', () => {
  const extending = row(20, {
    ...FIRST,
    messages: [
      { role: 'user', content: [{ type: 'text', text: 'summary' }] },
      { role: 'assistant', content: [{ type: 'text', text: 'ok' }] },
      { role: 'user', content: [{ type: 'text', text: 'two', cache_control: MARK }] },
    ],
  });

  test('tags each request with its turn', () => {
    expect(describeRequests([row(10, FIRST), extending], 15)).toEqual([
      'request 1 (first turn, sent 1970-01-01T00:00:00.010Z): 2 messages, markers at system[0], messages[0].content[0], messages[1].content[0]',
      'request 2 (next turn, sent 1970-01-01T00:00:00.020Z): 3 messages, markers at system[0], messages[2].content[0]',
    ]);
  });

  test('says when it extends the request before', () => {
    expect(nextTurnPairing([row(10, FIRST), extending], 15)[0]).toStartWith(
      'request 2 (first of the next turn) extends request 1',
    );
  });

  test('says where it stops extending', () => {
    const rewritten = row(20, {
      ...FIRST,
      messages: [{ role: 'user', content: [{ type: 'text', text: 'other summary' }] }],
    });
    expect(nextTurnPairing([row(10, FIRST), rewritten], 15)[1]).toBe(
      '  path: messages[0].content[0].text',
    );
  });

  test('needs a request on each side', () => {
    expect(nextTurnPairing([row(10, FIRST)], 15)).toEqual([
      'no request on each side of the next user message',
    ]);
  });
});

function said(...texts: string[]): JsonObject {
  return {
    system: [{ type: 'text', text: 'sys' }],
    messages: texts.map((text, index) => ({
      role: index % 2 === 0 ? 'user' : 'assistant',
      content: [{ type: 'text', text }],
    })),
  };
}

function usage(at: number, cacheRead: number, written: number): UsageLine {
  return {
    kind: 'usage',
    at: new Date(at).toISOString(),
    sessionId: 's',
    modelId: 'custom:haiku',
    version: '1.11.0',
    subagent: false,
    attempt: 1,
    reason: 'stop',
    inputTokens: 2,
    cacheReadInputTokens: cacheRead,
    totalInputTokens: cacheRead + written + 2,
    reasoningTokens: 0,
    outputTokens: 10,
    cachedTokensWritten: written,
  };
}

const READ = ['read the files', 'read 1', 'file 1'];
const SUMMARY = ['summary', 'read 2', 'file 2'];
const NEXT_AT = 45;
const COMPACTED_AT = [25];

function session(overrides: Record<number, JsonObject> = {}): BodyRow[] {
  const bodies = {
    10: said(...READ.slice(0, 1)),
    20: said(...READ),
    30: said(...SUMMARY.slice(0, 1)),
    40: said(...SUMMARY),
    50: said(...SUMMARY, 'done', 'two'),
    ...overrides,
  };
  return Object.entries(bodies).map(([t, body]) => row(Number(t), body));
}

const USAGE = [usage(41, 900, 100), usage(51, 1000, 10)];

function failures(rows: readonly BodyRow[], lines: readonly UsageLine[] = USAGE): string[] {
  const verdict = compactionTurnVerdict({
    rows,
    nextAt: NEXT_AT,
    compactedAt: COMPACTED_AT,
    usage: lines,
  });
  return verdict.text.split('\n').filter((line) => line.startsWith('FAIL'));
}

describe('compactionTurnVerdict', () => {
  test('passes when every request extends the one before, bar the first after the compaction', () => {
    const verdict = compactionTurnVerdict({
      rows: session(),
      nextAt: NEXT_AT,
      compactedAt: COMPACTED_AT,
      usage: USAGE,
    });
    expect(verdict.pass).toBe(true);
    expect(verdict.text.split('\n')).toContain(
      'pass  request 3 is the first after a compaction, so it starts a new cached prefix',
    );
    expect(verdict.text).toEndWith(
      'PASS: every main request extended the one before it, bar the first after each compaction, and the next user message read its cached prefix.',
    );
  });

  test('fails when a request before the compaction stops extending the one before', () => {
    expect(failures(session({ 20: said('other files', 'read 1', 'file 1') }))).toEqual([
      'FAIL  request 2 stops extending request 1 at messages[0] (user item) (messages[0].content[0].text), so it re-writes the cache from there',
      'FAIL: the session busted its prompt cache around the compaction, so it spent more tokens than it should.',
    ]);
  });

  test('fails when the next user message stops extending the request before', () => {
    expect(failures(session({ 50: said('other summary', 'done', 'two') }))[0]).toBe(
      'FAIL  request 5 (the next user message) stops extending request 4 at messages[0] (user item) (messages[0].content[0].text), so it re-writes the cache from there',
    );
  });

  test('fails when the next user message reads too little of its cached prefix', () => {
    expect(failures(session(), [usage(41, 900, 100), usage(51, 899, 120)])[0]).toBe(
      'FAIL  the next user message read only 899 of the 1,000-token cached prefix and wrote 120',
    );
  });

  test('fails when the compaction came before two requests could be compared', () => {
    const rows = session().filter((entry) => entry.t !== 10);
    expect(failures(rows)[0]).toBe(
      'FAIL  the reading turn sent fewer than two requests before it compacted, so nothing tested turn-to-turn reuse',
    );
  });
});
