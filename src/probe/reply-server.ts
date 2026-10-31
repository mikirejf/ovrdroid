import { pieces, streamEvents } from './stub-model.ts';

export interface ReplyServer {
  url: string;
  streamed: () => Promise<void>;
  stop: () => Promise<void>;
}

export function serveReply(text: string, chunk: number, gapMs: number): ReplyServer {
  const encoder = new TextEncoder();
  const events = streamEvents(pieces(text, chunk));
  const done = Promise.withResolvers<boolean>();
  const body = () =>
    new ReadableStream<Uint8Array>({
      async start(controller) {
        for (const event of events) {
          controller.enqueue(encoder.encode(event));
          // oxlint-disable-next-line no-await-in-loop
          await Bun.sleep(gapMs);
        }
        controller.close();
        done.resolve(true);
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
      return new Response(body(), { headers: { 'content-type': 'text/event-stream' } });
    },
  });
  return {
    url: `http://127.0.0.1:${server.port}`,
    streamed: async () => {
      await done.promise;
    },
    stop: async () => {
      await server.stop(true);
    },
  };
}
