import { describe, expect, test } from 'bun:test';

import {
  pieces,
  replyText,
  startStubModel,
  streamEvents,
  STUB_END,
  stubSettings,
} from '../stub-model.ts';

interface Delta {
  type: string;
  delta?: { text?: string };
}

function isDelta(value: unknown): value is Delta {
  return typeof value === 'object' && value !== null && 'type' in value;
}

function dataOf(stream: string): Delta[] {
  const found: Delta[] = [];
  for (const line of stream.split('\n')) {
    if (line.startsWith('data: ')) {
      const parsed: unknown = JSON.parse(line.slice('data: '.length));
      if (isDelta(parsed)) {
        found.push(parsed);
      }
    }
  }
  return found;
}

function textOf(stream: string): string {
  return dataOf(stream)
    .map((data) => data.delta?.text ?? '')
    .join('');
}

describe('replyText', () => {
  test('is the same text on every call, so runs compare', () => {
    expect(replyText(4000)).toBe(replyText(4000));
  });

  test('reaches the asked length and ends on the marker the reader looks for', () => {
    const text = replyText(4000);
    expect(text.length).toBeGreaterThanOrEqual(4000);
    expect(text.endsWith(STUB_END)).toBe(true);
  });

  test('holds headings, a list, a table and closed code blocks in two languages', () => {
    const text = replyText(4000);
    expect(text).toContain('\n## ');
    expect(text).toContain('\n- ');
    expect(text).toContain('| --- |');
    expect(text).toContain('```ts\n');
    expect(text).toContain('```python\n');
    expect(text.split('```').length % 2).toBe(1);
  });
});

describe('pieces', () => {
  test('cuts text into deltas that join back to the whole', () => {
    const cut = pieces('abcdefg', 3);
    expect(cut).toEqual(['abc', 'def', 'g']);
  });
});

describe('streamEvents', () => {
  test('wraps each delta in one Anthropic text delta, between a start and a stop', () => {
    const events = streamEvents(['Hel', 'lo']);
    expect(events).toHaveLength(4);

    const types = dataOf(events.join('')).map((data) => data.type);
    expect(types).toEqual([
      'message_start',
      'content_block_start',
      'content_block_delta',
      'content_block_delta',
      'content_block_stop',
      'message_delta',
      'message_stop',
    ]);

    expect(textOf(events.join(''))).toBe('Hello');
  });

  test('names each event the same as its data type, as the SSE parser expects', () => {
    for (const event of streamEvents(['x'])) {
      for (const block of event.split('\n\n').filter(Boolean)) {
        const [name = '', data = ''] = block.split('\n');
        expect(dataOf(data).map((parsed) => parsed.type)).toEqual([name.slice('event: '.length)]);
      }
    }
  });
});

describe('startStubModel', () => {
  test('streams the whole reply over HTTP and reports when it finished', async () => {
    const stub = startStubModel({ chars: 300, chunk: 40, gapMs: 0 });
    try {
      const finished = stub.nextStream();
      const response = await fetch(`${stub.url}/v1/messages`, { method: 'POST', body: '{}' });
      expect(textOf(await response.text())).toBe(replyText(300));
      const stream = await finished;
      expect(stream.endedAt).toBeGreaterThanOrEqual(stream.startedAt);
    } finally {
      await stub.stop();
    }
  });

  test('refuses any path other than messages', async () => {
    const stub = startStubModel({ chars: 10, chunk: 5, gapMs: 0 });
    try {
      const response = await fetch(`${stub.url}/v1/models`);
      expect(response.status).toBe(404);
    } finally {
      await stub.stop();
    }
  });
});

describe('stubSettings', () => {
  test('keeps the probe settings and makes the stub the session model', () => {
    const settings = stubSettings('http://127.0.0.1:9');
    expect(settings).toMatchObject({
      completionSound: 'off',
      customModels: [{ id: 'custom:stub-stream', baseUrl: 'http://127.0.0.1:9' }],
      sessionDefaultSettings: { model: 'custom:stub-stream' },
    });
  });
});
