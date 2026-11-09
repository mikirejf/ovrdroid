import { describe, expect, test } from 'bun:test';

import type { JsonObject } from '../bodies.ts';
import type { ProxyEntry } from '../proxy-log.ts';
import { accountMoves, describeProxyEntries, parseProxyLog } from '../proxy-log.ts';

const DROID: JsonObject = {
  model: 'claude-fable-5-2',
  system: [{ type: 'text', text: 'droid system', cache_control: { type: 'ephemeral' } }],
  messages: [{ role: 'user', content: 'hi' }],
};

const FORWARDED: JsonObject = {
  ...DROID,
  system: [
    { type: 'text', text: 'billing header' },
    { type: 'text', text: 'droid system', cache_control: { type: 'ephemeral' } },
  ],
  metadata: { user_id: 'u' },
};

interface Sent {
  account: string;
  sessionHeader: boolean;
}

const SENT: Sent = { account: 'one@example.com', sessionHeader: false };
const ACCOUNT_ONE = new Bun.CryptoHasher('sha256')
  .update('one@example.com')
  .digest('hex')
  .slice(0, 8);

function log(downstream: JsonObject, upstream: JsonObject, sent = SENT): string {
  return [
    '=== REQUEST INFO ===',
    'Version: 8.0.61',
    'Timestamp: 2026-11-09T23:30:00+01:00',
    '',
    '=== HEADERS ===',
    'Content-Type: application/json',
    ...(sent.sessionHeader ? ['X-Session-Id: session-1'] : []),
    '',
    '=== REQUEST BODY ===',
    JSON.stringify(downstream),
    '',
    '=== API REQUEST 1 ===',
    'Upstream URL: https://api.anthropic.com/v1/messages',
    `Auth: provider=claude, auth_id=${sent.account}, label=${sent.account}, type=oauth`,
    '',
    'Body:',
    JSON.stringify(upstream),
    '',
    '=== API RESPONSE 1 ===',
    'Status: 200',
    '',
    'Body:',
    'event: message_start',
    'data: {"type":"message_start","message":{"usage":{"input_tokens":3,"cache_creation_input_tokens":10,"cache_read_input_tokens":20}}}',
    '',
    'event: message_delta',
    'data: {"type":"message_delta","usage":{"input_tokens":3,"cache_creation_input_tokens":11,"cache_read_input_tokens":22,"output_tokens":4}}',
    '',
    '=== RESPONSE ===',
    'Status: 200',
  ].join('\n');
}

describe('parseProxyLog', () => {
  const entry = parseProxyLog(log(DROID, FORWARDED));

  test('reads both bodies and the last usage the response reported', () => {
    expect(entry.at).toBe('2026-11-09T23:30:00+01:00');
    expect(entry.downstream).toEqual(DROID);
    expect(entry.upstream).toEqual(FORWARDED);
    expect(entry.usage).toEqual({ input: 3, read: 22, written: 11 });
  });

  test('names the account by a hash of its id, never the id itself', () => {
    expect(entry.account).toBe(ACCOUNT_ONE);
    expect(JSON.stringify(describeProxyEntries([entry]))).not.toContain('example.com');
  });

  test('sees whether Droid sent a session id', () => {
    expect(entry.sentSessionId).toBe(false);
    expect(
      parseProxyLog(log(DROID, FORWARDED, { ...SENT, sessionHeader: true })).sentSessionId,
    ).toBe(true);
  });

  test('names what the proxy changed', () => {
    const lines = describeProxyEntries([entry]);
    expect(lines[0]).toBe(`every request went to account ${ACCOUNT_ONE}`);
    expect(lines[1]).toBe(
      `proxy request 1 at 2026-11-09T23:30:00+01:00 on account ${ACCOUNT_ONE}, without a session id from Droid: read 22, wrote 11, uncached 3; forwarded markers at system[1]`,
    );
    expect(lines[2]).toStartWith('  the proxy changed system');
    expect(lines).toContain('  the proxy changed settings: metadata');
    expect(lines).toContain(
      '  the proxy moved cache markers: Droid system[0]; forwarded system[1]',
    );
  });

  test('leaves the bodies out when the log lacks them', () => {
    expect(parseProxyLog('=== REQUEST INFO ===\nTimestamp: x\n')).toEqual({
      at: 'x',
      downstream: undefined,
      upstream: undefined,
      usage: undefined,
      account: 'unknown',
      sentSessionId: false,
    });
  });
});

function on(account: string): ProxyEntry {
  return {
    at: '',
    downstream: undefined,
    upstream: undefined,
    usage: undefined,
    account,
    sentSessionId: false,
  };
}

describe('accountMoves', () => {
  test('names each request that moved to another account', () => {
    expect(accountMoves([on('a'), on('a'), on('b'), on('a')])).toBe(
      'request 3 moved from account a to b; request 4 moved from account b to a',
    );
  });

  test('says when the session stayed on one account', () => {
    expect(accountMoves([on('a'), on('a')])).toBe('every request went to account a');
  });
});
