import { describe, expect, test } from 'bun:test';

import type { BodyRow, JsonObject } from '../bodies.ts';
import { describeRequests, markerPaths, nextTurnPairing } from '../compaction-turn-report.ts';

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
      'request 1 (first turn): 2 messages, markers at system[0], messages[0].content[0], messages[1].content[0]',
      'request 2 (next turn): 3 messages, markers at system[0], messages[2].content[0]',
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
