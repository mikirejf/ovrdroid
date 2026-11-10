import { setTimeout as delay } from 'node:timers/promises';

import { FLAG_ARM_DELAY_MS, FLAG_PRINCIPAL, flagReply } from './scope-leak-flags.ts';
import { mainTurnFor } from './scope-leak-report.ts';
import { chatEventsFor, eventsFor } from './scope-leak.ts';

async function waitUntil(atMs: number, signal: AbortSignal) {
  await delay(Math.max(0, atMs - Date.now()), undefined, { signal });
}
export function startFlagStub(run: string, wait = waitUntil) {
  const held = Promise.withResolvers<boolean>();
  const requested = Promise.withResolvers<boolean>();
  const stopping = new AbortController();
  const requests: { atMs: number; method: string; pathname: string; status: number }[] = [];
  let armed = false;
  let childTurns = 0;
  const timing = {
    firstFlagMs: 0,
    armedMs: 0,
    requestMs: 0,
    releasedMs: 0,
    responseChanged: false,
    aborted: false,
  };
  const server = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    idleTimeout: 0,
    async fetch(request) {
      const { pathname } = new URL(request.url);
      const row = { atMs: Date.now(), method: request.method, pathname, status: 200 };
      requests.push(row);
      if (pathname === '/api/cli/whoami') {
        return Response.json(FLAG_PRINCIPAL);
      }
      if (pathname === '/api/feature-flags') {
        if (timing.firstFlagMs === 0) {
          timing.firstFlagMs = row.atMs;
        }
        if (!armed) {
          row.status = 503;
          return Response.json({ error: 'flag refresh not armed' }, { status: 503 });
        }
        if (timing.requestMs === 0) {
          timing.requestMs = row.atMs;
          request.signal.addEventListener(
            'abort',
            () => {
              timing.aborted = true;
            },
            { once: true },
          );
        }
        requested.resolve(true);
        const changed = await held.promise;
        timing.responseChanged = changed;
        return Response.json(flagReply(changed));
      }
      if (request.method === 'POST' && pathname.endsWith('/chat/completions')) {
        const turn = mainTurnFor(await request.json());
        if (turn === 'launch') {
          if (timing.firstFlagMs === 0) {
            throw new Error('launch arrived before first flag request');
          }
          try {
            await wait(timing.firstFlagMs + FLAG_ARM_DELAY_MS, stopping.signal);
          } catch (error) {
            if (!stopping.signal.aborted) {
              throw error;
            }
          }
          if (stopping.signal.aborted) {
            row.status = 503;
            return new Response('stopping', { status: 503 });
          }
          timing.armedMs = Date.now();
          armed = true;
        } else {
          await delay(15_000, undefined, { signal: stopping.signal }).catch(() => null);
        }
        return new Response(chatEventsFor(turn, run), {
          headers: { 'content-type': 'text/event-stream' },
        });
      }
      if (request.method === 'POST' && pathname.endsWith('/messages')) {
        childTurns += 1;
        if (childTurns > 1) {
          await requested.promise;
        }
        return new Response(eventsFor(childTurns === 1 ? 'child-work' : 'child', run).join(''), {
          headers: { 'content-type': 'text/event-stream' },
        });
      }
      row.status = 404;
      return new Response('not found', { status: 404 });
    },
  });
  return {
    url: `http://127.0.0.1:${server.port}`,
    requests,
    timing,
    release() {
      timing.releasedMs = Date.now();
      held.resolve(true);
    },
    async stop() {
      requested.resolve(false);
      held.resolve(false);
      stopping.abort();
      await server.stop(true);
    },
  };
}
