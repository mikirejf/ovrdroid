import type { StubModel } from './stub-model.ts';
import { streamEvents } from './stub-model.ts';

const SIDE_REPLY = 'Stub title';

function carriesTools(body: string): boolean {
  const parsed: unknown = JSON.parse(body);
  return (
    typeof parsed === 'object' &&
    parsed !== null &&
    'tools' in parsed &&
    Array.isArray(parsed.tools) &&
    parsed.tools.length > 0
  );
}

export function keepToolCallForTurn(stub: StubModel): StubModel {
  const encoder = new TextEncoder();
  const sideReply = encoder.encode(streamEvents([SIDE_REPLY]).join(''));
  const server = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    async fetch(request) {
      const body = await request.text();
      if (!carriesTools(body)) {
        return new Response(sideReply, { headers: { 'content-type': 'text/event-stream' } });
      }
      return await fetch(stub.url + new URL(request.url).pathname, { method: 'POST', body });
    },
  });
  return {
    ...stub,
    url: `http://127.0.0.1:${server.port}`,
    stop: async () => {
      await server.stop(true);
      await stub.stop();
    },
  };
}
