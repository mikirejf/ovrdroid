import { setTimeout as delay } from 'node:timers/promises';

import { fieldsOf, worded } from './fields.ts';
import {
  childWorkDone,
  responsesWorkDone,
  RESPONSES_CHILD,
  FOLLOWUP_CHILD,
  mainTurnFor,
  WAIT_MAIN_MODEL,
  waitCalls,
  waitLaunches,
} from './scope-leak-report.ts';
import { RESPONSES_MODEL, responsesEvents, responsesReleaseDelay } from './scope-leak-responses.ts';
import type { ResponsesRequest } from './scope-leak-responses.ts';
import { mixWork } from './scope-leak-tool-mix.ts';
import type { MixWork } from './scope-leak-tool-mix.ts';
import { CHILD_INPUT, CHAT_MODEL, eventsFor, chatEventsFor } from './scope-leak.ts';
import type { Stub } from './scope-leak.ts';
import { streamEvents, toolBatchEvents } from './stub-model.ts';
import type { ToolCall } from './stub-model.ts';

interface WaitStub extends Stub {
  bodies: unknown[];
  phases: { atMs: number; phase: string; child?: number }[];
  waits: ToolCall[];
  held: Set<number>;
  streams: ResponsesRequest[];
  work: MixWork[];
}
export function startWaitStub(
  run: string,
  lingerMs: number,
  {
    beforeFirstReply,
    responsesChild = false,
    responsesFollowup = false,
    mixFile,
  }: {
    beforeFirstReply?: () => void;
    responsesChild?: boolean;
    responsesFollowup?: boolean;
    mixFile?: string | undefined;
  } = {},
): WaitStub {
  const release = Promise.withResolvers<boolean>();
  const stopping = new AbortController();
  const bodies: unknown[] = [];
  const phases: WaitStub['phases'] = [];
  const waits: ToolCall[] = [];
  const held = new Set<number>();
  const streams: ResponsesRequest[] = [];
  const work: MixWork[] = [];
  const r1End = Promise.withResolvers<number>();
  let launched = false;
  let replied = false;
  const pause = async (ms: number) => {
    await delay(ms, undefined, { signal: stopping.signal }).catch(() => null);
  };
  const streamed = (events: readonly string[], timing: ResponsesRequest, final: boolean) =>
    new Response(
      new ReadableStream<Uint8Array>({
        async start(controller) {
          timing.firstWriteMs = Date.now();
          for (const event of events) {
            controller.enqueue(new TextEncoder().encode(event));
            // oxlint-disable-next-line no-await-in-loop
            await pause(responsesFollowup && timing.child === FOLLOWUP_CHILD ? 250 : 40);
          }
          controller.close();
          timing.endedMs = Date.now();
          if (final && timing.child === RESPONSES_CHILD) {
            r1End.resolve(timing.endedMs);
          }
        },
      }),
      { headers: { 'content-type': 'text/event-stream' } },
    );
  const prepareResponses = async (timing: ResponsesRequest, final: boolean) => {
    streams.push(timing);
    if (responsesFollowup && timing.child === FOLLOWUP_CHILD && !final) {
      await pause(responsesReleaseDelay(await r1End.promise, Date.now()));
    }
  };
  const mainEvents = (body: unknown): string[] => {
    if (mainTurnFor(body) === 'launch' && !launched) {
      phases.push({ atMs: Date.now(), phase: 'launch-batch' });
      launched = true;
      return toolBatchEvents(waitLaunches(run, responsesChild, responsesFollowup));
    }
    if (launched && waits.length === 0) {
      waits.push(...waitCalls(body, run));
      phases.push({ atMs: Date.now(), phase: 'wait-batch' });
      return toolBatchEvents(waits);
    }
    phases.push({ atMs: Date.now(), phase: launched ? 'main-after-waits' : 'title' });
    return streamEvents(['ok']);
  };
  const workEvents = (body: unknown, child: number, responses: boolean): string[] => {
    if (mixFile === undefined) {
      return responses
        ? responsesEvents(`${run}_${child}_work`, {
            id: `call_work${run}_${child}`,
            name: 'Execute',
            input: CHILD_INPUT,
          })
        : eventsFor('child-work', `${run}_${child}`);
    }
    const batch = mixWork(body, mixFile, {
      child,
      id: `${responses ? 'call' : 'toolu'}_work${run}_${child}`,
    });
    work.push(batch);
    return responses
      ? responsesEvents(`${run}_${child}_work`, {
          ...batch.call,
          customInput: worded(fieldsOf(batch.call.input), 'script'),
        })
      : toolBatchEvents([batch.call]);
  };
  const server = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    idleTimeout: 0,
    async fetch(request) {
      if (request.method !== 'POST') {
        return new Response('not found', { status: 404 });
      }
      const { pathname } = new URL(request.url);
      const body: unknown = await request.json();
      bodies.push(responsesChild ? { path: pathname, body } : body);
      const model = worded(fieldsOf(body), 'model');
      const responses = pathname.endsWith('/responses');
      const tag = /hold:scope(?<index>\d+)/u.exec(JSON.stringify(body))?.groups?.['index'];
      const child = Number(tag);
      const final = responsesWorkDone(body) || childWorkDone(body);
      const timing = {
        child,
        path: pathname,
        requestedAtMs: Date.now(),
        firstWriteMs: 0,
        endedMs: 0,
      };
      if (responses) {
        await prepareResponses(timing, final);
      }
      if (model === RESPONSES_MODEL && !responses) {
        throw new Error('Responses child did not use the HTTP Responses endpoint');
      }
      let events: string[];
      if (model === WAIT_MAIN_MODEL) {
        events = mainEvents(body);
      } else if (tag === undefined) {
        phases.push({ atMs: Date.now(), phase: 'title' });
        events = streamEvents(['Scope probe']);
      } else {
        if (model === CHAT_MODEL) {
          held.add(child);
          phases.push({ atMs: Date.now(), phase: 'held-child', child });
          await pause(2_147_483_647);
          return new Response(chatEventsFor('text', run), {
            headers: { 'content-type': 'text/event-stream' },
          });
        }
        if (final) {
          phases.push({ atMs: Date.now(), phase: 'quick-held', child });
          await release.promise;
          await pause(responsesFollowup && child === FOLLOWUP_CHILD ? 0 : lingerMs + child * 500);
          if (!replied) {
            replied = true;
            beforeFirstReply?.();
          }
          phases.push({ atMs: Date.now(), phase: 'quick-replied', child });
          events = responses
            ? responsesEvents(`${run}_${child}_text`, ['h', 'i', '\n'])
            : streamEvents([`scope child ${child} complete`]);
        } else {
          phases.push({ atMs: Date.now(), phase: 'child-work', child });
          events = workEvents(body, child, responses);
        }
      }
      return responses
        ? streamed(events, timing, final)
        : new Response(events.join(''), { headers: { 'content-type': 'text/event-stream' } });
    },
  });
  return {
    url: `http://127.0.0.1:${server.port}`,
    bodies,
    phases,
    waits,
    held,
    streams,
    work,
    release: () => {
      release.resolve(true);
    },
    stop: async () => {
      release.resolve(true);
      stopping.abort();
      r1End.resolve(Date.now());
      await server.stop(true);
    },
  };
}
