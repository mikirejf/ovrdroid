import { afterEach, describe, expect, test } from 'bun:test';

import { startCompactionRelay } from '../compaction-relay.ts';
import { fieldsOf, fieldsOfJson, worded } from '../fields.ts';
import { reuseBody, stockCaptured } from './compaction-replay-harness.ts';

const REPLY = 'No summary today.';
const UPSTREAM_REPLY = 'data: upstream\n\n';

interface Seen {
  key: string | null;
  beta: string | null;
  body: string;
}

let stops: (() => Promise<void>)[] = [];

afterEach(async () => {
  await Promise.all(
    stops.map(async (stop) => {
      await stop();
    }),
  );
  stops = [];
});

function startUpstream() {
  const seen: Seen[] = [];
  const server = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    async fetch(request) {
      seen.push({
        key: request.headers.get('x-api-key'),
        beta: request.headers.get('anthropic-beta'),
        body: await request.text(),
      });
      return new Response(UPSTREAM_REPLY, { headers: { 'content-type': 'text/event-stream' } });
    },
  });
  stops.push(async () => {
    await server.stop(true);
  });
  return { seen, endpoint: `http://127.0.0.1:${server.port}/v1/messages` };
}

async function ask(url: string, body: unknown): Promise<string> {
  const response = await fetch(`${url}/v1/messages`, {
    method: 'POST',
    headers: { 'x-api-key': 'relay', 'anthropic-beta': 'thinking-x' },
    body: JSON.stringify(body),
  });
  return await response.text();
}

function streamedText(stream: string): string {
  return stream
    .split('\n')
    .filter((line) => line.startsWith('data: '))
    .map((line) => worded(fieldsOf(fieldsOfJson(line.slice('data: '.length)).get('delta')), 'text'))
    .join('');
}

describe('the compaction relay', () => {
  test('forwards ordinary and stock requests unchanged, with the real key and the original beta header', async () => {
    const upstream = startUpstream();
    const relay = startCompactionRelay(
      { endpoint: upstream.endpoint, headers: { 'x-api-key': 'real' } },
      REPLY,
    );
    stops.push(relay.stop);

    const ordinary = { messages: [{ role: 'user', content: 'hi' }] };
    expect(await ask(relay.url, ordinary)).toBe(UPSTREAM_REPLY);
    expect(await ask(relay.url, stockCaptured())).toBe(UPSTREAM_REPLY);
    expect(upstream.seen).toEqual([
      { key: 'real', beta: 'thinking-x', body: JSON.stringify(ordinary) },
      { key: 'real', beta: 'thinking-x', body: JSON.stringify(stockCaptured()) },
    ]);
  });

  test('answers the reuse request with the canned reply as a stream and never forwards it', async () => {
    const upstream = startUpstream();
    const relay = startCompactionRelay(
      { endpoint: upstream.endpoint, headers: { 'x-api-key': 'real' } },
      REPLY,
    );
    stops.push(relay.stop);

    const stream = await ask(relay.url, reuseBody());
    expect(streamedText(stream)).toBe(REPLY);
    expect(stream).toContain('"stop_reason":"end_turn"');
    expect(upstream.seen).toEqual([]);
  });

  test('records the kind of each request in order', async () => {
    const upstream = startUpstream();
    const relay = startCompactionRelay({ endpoint: upstream.endpoint, headers: {} }, REPLY);
    stops.push(relay.stop);

    await ask(relay.url, { messages: [{ role: 'user', content: 'hi' }] });
    await ask(relay.url, reuseBody());
    await ask(relay.url, stockCaptured());
    expect(relay.kinds()).toEqual(['ordinary', 'reuse', 'stock']);
  });
});
