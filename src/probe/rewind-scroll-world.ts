import { readFileSync } from 'node:fs';
import path from 'node:path';

import { fieldsOfJson, worded } from './fields.ts';
import { answerFor } from './rewind-scroll-report.ts';
import { streamEvents, stubSettings, TITLE_MARKER } from './stub-model.ts';

const PROMPT_TOPIC = /scroll probe message (?<topic>[A-Z0-9]+) /u;

export interface Stub {
  url: string;
  settings: ReturnType<typeof stubSettings>;
  stop: () => Promise<void>;
}

export function startStub(): Stub {
  const server = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    async fetch(request) {
      if (request.method !== 'POST' || !new URL(request.url).pathname.endsWith('/messages')) {
        return new Response('not found', { status: 404 });
      }
      const body = await request.text();
      const messages = fieldsOfJson(body).get('messages');
      const last = Array.isArray(messages) ? JSON.stringify(messages.at(-1)) : '';
      const topic = body.includes(TITLE_MARKER)
        ? undefined
        : PROMPT_TOPIC.exec(last)?.groups?.['topic'];
      const reply = topic === undefined ? 'Stub title' : answerFor(topic);
      return new Response(streamEvents([reply]).join(''), {
        headers: { 'content-type': 'text/event-stream' },
      });
    },
  });
  return {
    url: `http://127.0.0.1:${server.port}`,
    settings: stubSettings(`http://127.0.0.1:${server.port}`),
    stop: async () => {
      await server.stop(true);
    },
  };
}

export function chatsWith(folder: string, text: string): string[] {
  return [...new Bun.Glob('*.jsonl').scanSync(folder)]
    .filter((file) => readFileSync(path.join(folder, file), 'utf-8').includes(text))
    .map((file) => file.slice(0, -'.jsonl'.length));
}

export function forkOf(folder: string, chat: string): string | undefined {
  for (const file of new Bun.Glob('*.jsonl').scanSync(folder)) {
    const [first = ''] = readFileSync(path.join(folder, file), 'utf-8').split('\n', 1);
    const start = fieldsOfJson(first);
    if (worded(start, 'type') === 'session_start' && worded(start, 'parent') === chat) {
      return path.join(folder, file);
    }
  }
  return undefined;
}
