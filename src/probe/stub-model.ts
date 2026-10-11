import { setTimeout as delay } from 'node:timers/promises';

import { PROBE_SETTINGS } from './launch.ts';

export const STUB_END = 'End of the stub reply.';
const STUB_MODEL = 'stub-stream';
const STUB_ID = `custom:${STUB_MODEL}`;

export interface ReplyPlan {
  chars: number;
  chunk: number;
  gapMs: number;
}

const TOPICS = ['parsing', 'caching', 'rendering', 'scheduling', 'logging', 'retrying'] as const;

function codeBlock(topic: string, index: number): string {
  if (index % 2 === 0) {
    return [
      '```ts',
      `export function ${topic}Step(input: readonly number[]): number {`,
      '  let total = 0;',
      '  for (const value of input) {',
      `    total += value * ${index + 2};`,
      '  }',
      '  return total;',
      '}',
      '```',
    ].join('\n');
  }
  return [
    '```python',
    `def ${topic}_step(values: list[int]) -> int:`,
    '    total = 0',
    '    for value in values:',
    `        total += value * ${index + 2}`,
    '    return total',
    '```',
  ].join('\n');
}

function table(topic: string, index: number): string {
  return [
    '| Stage | Cost | Note |',
    '| --- | ---: | --- |',
    `| ${topic} read | ${index + 3}ms | warm cache |`,
    `| ${topic} write | ${index * 2 + 5}ms | one flush per batch |`,
    `| ${topic} total | ${index * 3 + 8}ms | measured once |`,
  ].join('\n');
}

function section(index: number): string {
  const topic = TOPICS[index % TOPICS.length] ?? 'parsing';
  const parts = [
    `## ${index + 1}. How ${topic} works`,
    `The ${topic} stage takes the input one record at a time and keeps a small amount of state between records. It never holds the whole input in memory, so it stays fast when the input grows. Each record passes through the same three steps, and each step can fail on its own.`,
    [
      `- The first step reads the record and checks its shape before ${topic} starts.`,
      '- The second step does the real work and writes a **short summary** of what changed.',
      `- The third step hands the result to the next stage and records the \`${topic}\` time.`,
    ].join('\n'),
  ];
  if (index < 3) {
    parts.push(codeBlock(topic, index));
  }
  if (index === 1) {
    parts.push(table(topic, index));
  }
  parts.push(
    `When a step fails, the stage logs the record number and moves on. A later pass retries the failed records, so one bad record never stops the run.`,
  );
  return parts.join('\n\n');
}

export function replyText(chars: number): string {
  const title = '# A long answer about a small pipeline';
  const sections = [title];
  let { length } = title;
  for (let index = 0; length < chars; index++) {
    const next = section(index);
    sections.push(next);
    length += next.length + 2;
  }
  sections.push(STUB_END);
  return sections.join('\n\n');
}

export function pieces(text: string, size: number): string[] {
  const result: string[] = [];
  for (let start = 0; start < text.length; start += size) {
    result.push(text.slice(start, start + size));
  }
  return result;
}

type Json = string | number | null | readonly Json[] | { readonly [key: string]: Json };

interface StreamEvent {
  readonly type: string;
  readonly [field: string]: Json;
}

function event(data: StreamEvent): string {
  return `event: ${data.type}\ndata: ${JSON.stringify(data)}\n\n`;
}

export function streamEvents(deltas: readonly string[]): string[] {
  return [
    event({
      type: 'message_start',
      message: {
        id: 'msg_stub',
        type: 'message',
        role: 'assistant',
        model: STUB_MODEL,
        content: [],
        stop_reason: null,
        stop_sequence: null,
        usage: { input_tokens: 1, output_tokens: 1 },
      },
    }) +
      event({
        type: 'content_block_start',
        index: 0,
        content_block: { type: 'text', text: '' },
      }),
    ...deltas.map((text) =>
      event({
        type: 'content_block_delta',
        index: 0,
        delta: { type: 'text_delta', text },
      }),
    ),
    event({ type: 'content_block_stop', index: 0 }) +
      event({
        type: 'message_delta',
        delta: { stop_reason: 'end_turn', stop_sequence: null },
        usage: { output_tokens: deltas.length },
      }) +
      event({ type: 'message_stop' }),
  ];
}

export function stubSettings(url: string) {
  return {
    ...PROBE_SETTINGS,
    customModels: [
      {
        id: STUB_ID,
        model: STUB_MODEL,
        displayName: 'Stub Stream',
        provider: 'anthropic',
        baseUrl: url,
        apiKey: 'stub',
        maxOutputTokens: 8000,
        noImageSupport: true,
      },
    ],
    sessionDefaultSettings: {
      model: STUB_ID,
      reasoningEffort: 'none',
      autonomyLevel: 'high',
      autonomyMode: 'auto-high',
      interactionMode: 'auto',
    },
    sessionTitleModel: STUB_ID,
  };
}

export interface StubStream {
  startedAt: number;
  endedAt: number;
}

export interface StubModel {
  url: string;
  nextStream: () => Promise<StubStream>;
  stop: () => Promise<void>;
}

export function startStubModel(plan: ReplyPlan): StubModel {
  const encoder = new TextEncoder();
  const events = streamEvents(pieces(replyText(plan.chars), plan.chunk));
  let waiting = Promise.withResolvers<StubStream>();

  const replyBody = () =>
    new ReadableStream<Uint8Array>({
      async start(controller) {
        const startedAt = performance.now();
        for (const [index, text] of events.entries()) {
          if (index > 0) {
            // oxlint-disable-next-line no-await-in-loop
            await delay(plan.gapMs);
          }
          controller.enqueue(encoder.encode(text));
        }
        controller.close();
        const done = waiting;
        waiting = Promise.withResolvers<StubStream>();
        done.resolve({ startedAt, endedAt: performance.now() });
      },
    });

  const server = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    async fetch(request) {
      await request.arrayBuffer();
      if (request.method !== 'POST' || !new URL(request.url).pathname.endsWith('/messages')) {
        return new Response('not found', { status: 404 });
      }
      return new Response(replyBody(), { headers: { 'content-type': 'text/event-stream' } });
    },
  });

  return {
    url: `http://127.0.0.1:${server.port}`,
    nextStream: async () => await waiting.promise,
    stop: async () => {
      await server.stop(true);
    },
  };
}
