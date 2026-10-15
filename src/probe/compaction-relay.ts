import type { RequestKind } from './compaction-fallback-report.ts';
import { isJsonObject, requestKind } from './compaction-fallback-report.ts';
import { readCredentials } from './credentials.ts';
import { parseJson } from './fields.ts';
import { PROBE_MODEL, PROBE_SETTINGS } from './launch.ts';
import { pieces, streamEvents } from './stub-model.ts';

export const RELAY_MODEL_ID = 'custom:od-relay-haiku';

const REFUSAL_CHUNK_CHARS = 24;
const DROPPED_REQUEST_HEADERS = new Set([
  'host',
  'content-length',
  'connection',
  'accept-encoding',
]);

export interface Upstream {
  endpoint: string;
  headers: Record<string, string>;
}

export async function readUpstream(): Promise<Upstream> {
  const { endpoint, headers } = await readCredentials(PROBE_MODEL, false);
  return { endpoint, headers };
}

export function relaySettings(url: string) {
  return {
    ...PROBE_SETTINGS,
    customModels: [
      {
        id: RELAY_MODEL_ID,
        model: 'claude-haiku-5-5',
        displayName: 'Relay Haiku',
        provider: 'anthropic',
        baseUrl: url,
        apiKey: 'relay',
        enableThinking: true,
        maxOutputTokens: 128_000,
        noImageSupport: false,
      },
    ],
    sessionDefaultSettings: { ...PROBE_SETTINGS.sessionDefaultSettings, model: RELAY_MODEL_ID },
  };
}

export interface CompactionRelay {
  url: string;
  kinds: () => readonly RequestKind[];
  stop: () => Promise<void>;
}

function forwardHeaders(incoming: Headers, own: Record<string, string>): Headers {
  const headers = new Headers();
  for (const [name, value] of incoming) {
    if (!DROPPED_REQUEST_HEADERS.has(name)) {
      headers.set(name, value);
    }
  }
  for (const [name, value] of Object.entries(own)) {
    headers.set(name, value);
  }
  return headers;
}

function refusalResponse(reply: string): Response {
  return new Response(streamEvents(pieces(reply, REFUSAL_CHUNK_CHARS)).join(''), {
    headers: { 'content-type': 'text/event-stream' },
  });
}

async function forward(request: Request, body: string, upstream: Upstream): Promise<Response> {
  const response = await fetch(upstream.endpoint, {
    method: 'POST',
    headers: forwardHeaders(request.headers, upstream.headers),
    body,
  });
  return new Response(response.body, {
    status: response.status,
    headers: { 'content-type': response.headers.get('content-type') ?? 'text/event-stream' },
  });
}

export function startCompactionRelay(upstream: Upstream, reply: string): CompactionRelay {
  const kinds: RequestKind[] = [];
  const server = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    async fetch(request) {
      if (request.method !== 'POST' || !new URL(request.url).pathname.endsWith('/messages')) {
        return new Response('not found', { status: 404 });
      }
      const body = await request.text();
      const kind = requestKind(parseJson(body, isJsonObject));
      kinds.push(kind);
      return kind === 'reuse' ? refusalResponse(reply) : await forward(request, body, upstream);
    },
  });
  return {
    url: `http://127.0.0.1:${server.port}`,
    kinds: () => kinds,
    stop: async () => {
      await server.stop(true);
    },
  };
}
