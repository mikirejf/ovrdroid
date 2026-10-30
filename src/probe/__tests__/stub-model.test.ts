import { describe, expect, test } from 'bun:test';

import {
  pieces,
  replyText,
  startStubModel,
  streamEvents,
  STUB_END,
  stubSettings,
  TITLE_MARKER,
  toolBatchEvents,
  toolEvents,
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

describe('toolEvents', () => {
  test('sends one tool call whose input arrives as JSON and ends the turn on tool_use', () => {
    const events = toolEvents({ name: 'Execute', input: { command: 'sleep 9' } });
    const joined = events.join('');
    expect(joined).toContain('"type":"tool_use"');
    expect(joined).toContain('"name":"Execute"');
    expect(joined).toContain('"stop_reason":"tool_use"');

    const delta = dataOf(joined).find((data) => data.type === 'content_block_delta');
    expect(JSON.stringify(delta)).toContain(
      JSON.stringify(JSON.stringify({ command: 'sleep 9' })).slice(1, -1),
    );
  });
});

describe('toolBatchEvents', () => {
  test('sends each call as its own indexed tool_use block in one message that ends on tool_use', () => {
    const joined = toolBatchEvents([
      { id: 'one', name: 'Edit', input: { old_str: 'a' } },
      { id: 'two', name: 'Edit', input: { old_str: 'b' } },
    ]).join('');
    const data = dataOf(joined);
    expect(data.map((entry) => entry.type)).toEqual([
      'message_start',
      'content_block_start',
      'content_block_delta',
      'content_block_stop',
      'content_block_start',
      'content_block_delta',
      'content_block_stop',
      'message_delta',
      'message_stop',
    ]);
    expect(joined).toContain('"id":"one"');
    expect(joined).toContain('"id":"two"');
    expect(joined).toContain('"index":1');
    expect(joined).toContain('"stop_reason":"tool_use"');
  });
});

describe('startStubModel', () => {
  test('answers the first request with the tool call and later ones with the reply', async () => {
    const stub = startStubModel(
      { chars: 20, chunk: 10, gapMs: 0 },
      { name: 'Execute', input: { command: 'sleep 9' } },
    );
    try {
      const ask = async () => {
        const response = await fetch(`${stub.url}/v1/messages`, { method: 'POST', body: '{}' });
        return await response.text();
      };
      expect(await ask()).toContain('"type":"tool_use"');
      expect(textOf(await ask())).toBe(replyText(20));
    } finally {
      await stub.stop();
    }
  });

  test('cuts the first reply short with no terminal event and serves later ones whole', async () => {
    const stub = startStubModel({ chars: 300, chunk: 40, gapMs: 0 }, undefined, {
      cutFirstReplyAfter: 2,
    });
    try {
      const ask = async () => {
        const response = await fetch(`${stub.url}/v1/messages`, { method: 'POST', body: '{}' });
        return await response.text();
      };
      const cut = await ask();
      expect(textOf(cut)).toBe(pieces(replyText(300), 40).slice(0, 2).join(''));
      expect(cut).not.toContain('message_stop');
      expect(textOf(await ask())).toBe(replyText(300));
      expect(stub.served()).toEqual(['cut', 'full']);
    } finally {
      await stub.stop();
    }
  });

  test('a title request does not use up the cut', async () => {
    const stub = startStubModel({ chars: 300, chunk: 40, gapMs: 0 }, undefined, {
      cutFirstReplyAfter: 2,
    });
    try {
      const ask = async (body: string) => {
        const response = await fetch(`${stub.url}/v1/messages`, { method: 'POST', body });
        return await response.text();
      };
      expect(textOf(await ask(`write a title. ${TITLE_MARKER}`))).toBe('Stub title');
      expect(await ask('{}')).not.toContain('message_stop');
      expect(stub.served()).toEqual(['title', 'cut']);
    } finally {
      await stub.stop();
    }
  });

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
  test('names the stub model when asked, in the model list and as the session model', () => {
    const settings = stubSettings('http://127.0.0.1:9', 'claude-sonnet-x');
    expect(settings).toMatchObject({
      customModels: [{ id: 'custom:claude-sonnet-x', model: 'claude-sonnet-x' }],
      sessionDefaultSettings: { model: 'custom:claude-sonnet-x' },
      sessionTitleModel: 'custom:claude-sonnet-x',
    });
  });

  test('keeps the probe settings and makes the stub the session model', () => {
    const settings = stubSettings('http://127.0.0.1:9');
    expect(settings).toMatchObject({
      completionSound: 'off',
      customModels: [{ id: 'custom:stub-stream', baseUrl: 'http://127.0.0.1:9' }],
      sessionDefaultSettings: { model: 'custom:stub-stream' },
    });
  });
});
