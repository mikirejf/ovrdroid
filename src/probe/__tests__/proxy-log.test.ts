import { describe, expect, test } from 'bun:test';

import type { JsonObject } from '../bodies.ts';
import { describeProxyEntries, parseProxyLog } from '../proxy-log.ts';

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

function log(downstream: JsonObject, upstream: JsonObject): string {
  return [
    '=== REQUEST INFO ===',
    'Version: 8.0.61',
    'Timestamp: 2026-11-09T23:30:00+01:00',
    '',
    '=== HEADERS ===',
    'Content-Type: application/json',
    '',
    '=== REQUEST BODY ===',
    JSON.stringify(downstream),
    '',
    '=== API REQUEST 1 ===',
    'Upstream URL: https://api.anthropic.com/v1/messages',
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

  test('names what the proxy changed', () => {
    const lines = describeProxyEntries([entry]);
    expect(lines[0]).toBe(
      'proxy request 1 at 2026-11-09T23:30:00+01:00: read 22, wrote 11, uncached 3; forwarded markers at system[1]',
    );
    expect(lines[1]).toStartWith('  the proxy changed system');
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
    });
  });
});
