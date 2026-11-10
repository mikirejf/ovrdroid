import { describe, expect, test } from 'bun:test';

import { fieldsOfJson, worded } from '../fields.ts';
import {
  waitLaunches,
  waitLogReading,
  responsesWorkDone,
  RESPONSES_CHILD,
  FOLLOWUP_CHILD,
  waitReportsExercised,
  outcomeOf,
} from '../scope-leak-report.ts';
import type { ResponsesChildEvidence, ScopeLeakRun } from '../scope-leak-report.ts';
import {
  RESPONSES_MODEL,
  responsesEvents,
  responsesSettings,
  responsesReleaseDelay,
} from '../scope-leak-responses.ts';
import { COVERED_REPORTS as COVERED } from '../scope-leak-test-fixtures.ts';

const PID = 4242;
const SHUTDOWN_LINE = '[Tool] Task tool manager shutting down';
function user(content: string) {
  return { role: 'user', content };
}
function run(events: [], exited = false): ScopeLeakRun {
  return { binary: '/tmp/droid-a', events, exited };
}
type LogContext = Record<string, string | { sessionId: string }>;
function line(message: string, context: LogContext, pid = PID): string {
  return `[2026-11-10T12:00:00.000Z] INFO: ${message} | Context: ${JSON.stringify({ ...context, 'process.pid': pid })}`;
}
describe('Responses child', () => {
  test('only the final quick launch uses a local OpenAI model', () => {
    const original = waitLaunches('run');
    const changed = waitLaunches('run', true);
    expect(changed[RESPONSES_CHILD]?.input['subagent_type']).toBe('ovrdroid-scope-wait-responses');
    expect(changed.filter((_, i) => i !== RESPONSES_CHILD)).toEqual(
      original.filter((_, i) => i !== RESPONSES_CHILD),
    );
    expect(responsesSettings('http://127.0.0.1:12345').customModels[0]).toMatchObject({
      model: RESPONSES_MODEL,
      provider: 'openai',
      baseUrl: 'http://127.0.0.1:12345/v1',
    });
  });
  test.each(['function_call', 'function_call_output'])('classifies Responses %s input', (type) => {
    expect(
      responsesWorkDone({ input: [{ type, call_id: 'call_work1', output: 'scope-leak' }] }),
    ).toBe(type === 'function_call_output');
    expect(responsesWorkDone({ input: [{ type, call_id: 'other' }] })).toBe(false);
    expect(responsesWorkDone({ messages: [user('function_call_output call_work1')] })).toBe(false);
  });
  test.each(['tool', 'text'])('builds a complete streaming Responses %s turn', (turn) => {
    const call = { id: 'call_work1', name: 'Execute', input: { command: 'echo scope-leak' } };
    const events = responsesEvents('turn', turn === 'tool' ? call : ['h', 'i', '\n']).map((frame) =>
      fieldsOfJson(frame.split('\ndata: ')[1] ?? ''),
    );
    const types = events.map((event) => worded(event, 'type'));
    expect(types[0]).toBe('response.created');
    expect(types[1]).toBe('response.in_progress');
    expect(types[2]).toBe('response.output_item.added');
    const deltaType =
      turn === 'tool' ? 'response.function_call_arguments.delta' : 'response.output_text.delta';
    const deltas = events.filter((event) => worded(event, 'type') === deltaType);
    expect(deltas.length).toBeGreaterThanOrEqual(3);
    expect(deltas.map((event) => worded(event, 'delta')).join('')).toBe(
      turn === 'tool' ? JSON.stringify(call.input) : 'hi\n',
    );
    expect(types.slice(-2)).toEqual(['response.output_item.done', 'response.completed']);
    expect(events.at(-1)?.get('response')).toMatchObject({
      status: 'completed',
      usage: { output_tokens: 1 },
    });
  });
  test('requires every Responses-child coverage item', () => {
    const responsesChild = {
      sessionId: 'child10',
      requests: 2,
      completed: true,
      closed: true,
      tornDown: true,
      lastTeardown: true,
      teardownMs: 100,
      closedMs: 101,
      streams: [],
    };
    expect(waitReportsExercised({ ...COVERED, responsesChild })).toBe(true);
    for (const missing of [
      { sessionId: '' },
      { requests: 1 },
      { completed: false },
      { closed: false },
      { tornDown: false },
      { lastTeardown: false },
    ]) {
      expect(
        outcomeOf({
          ...run([]),
          waitReports: { ...COVERED, responsesChild: { ...responsesChild, ...missing } },
        }),
      ).toBe('unproven');
    }
  });
  test('attributes close metrics only to a unique pending child teardown', () => {
    const close = line('[metrics_log_daemon_agent_host_close_count]', {
      type: 'in_process',
      outcome: 'success',
    });
    const first = line(SHUTDOWN_LINE, { sessionId: 'child1' });
    const last = line(SHUTDOWN_LINE, { sessionId: 'child10' });
    const context = { main: 'main', children: ['child1', 'child10'] };
    const reading = waitLogReading([first, close, last, close].join('\n'), PID, context);
    expect(reading.closedChildren).toEqual(['child1', 'child10']);
    expect(reading.lastTornDownChild).toBe('child10');
    expect(
      waitLogReading([first, last, close, close].join('\n'), PID, context).closedChildren,
    ).toEqual([]);
  });
});
describe('Responses followup', () => {
  const stream = {
    child: FOLLOWUP_CHILD,
    path: '/v1/responses',
    requestedAtMs: 1,
    firstWriteMs: 4000,
    endedMs: 6500,
  };
  const first: ResponsesChildEvidence = {
    sessionId: 'r1',
    requests: 2,
    completed: true,
    closed: true,
    tornDown: true,
    lastTeardown: false,
    teardownMs: 1001,
    closedMs: 1002,
    streams: [
      { ...stream, endedMs: 900 },
      { ...stream, endedMs: 1000 },
    ],
  };
  const next: ResponsesChildEvidence = {
    ...first,
    sessionId: 'r2',
    lastTeardown: true,
    streams: [stream, { ...stream, firstWriteMs: 6600, endedMs: 9100 }],
  };
  test.each([
    [0, 100, Infinity],
    [1000, 1000, 3000],
    [1000, 3999, 1],
    [1000, 4000, 0],
    [1000, 5000, 0],
  ])('release delay after end %i at %i is %i', (ended, now, expected) => {
    expect(responsesReleaseDelay(ended, now)).toBe(expected);
  });
  test('launches R1 and R2 on Responses without changing held or total launches', () => {
    const calls = waitLaunches('run', true, true);
    expect(calls).toHaveLength(14);
    expect(
      calls.filter((call) => call.input['subagent_type'] === 'ovrdroid-scope-wait-responses'),
    ).toHaveLength(2);
    expect(calls[FOLLOWUP_CHILD]?.input['prompt']).toBe('hold:scope9');
  });
  test('requires both children and timestamps proving a slow stream after R1 closed', () => {
    const covered = { ...COVERED, responsesChild: first, responsesFollowup: next };
    expect(waitReportsExercised(covered)).toBe(true);
    expect(waitReportsExercised({ ...COVERED, responsesFollowup: next })).toBe(false);
    for (const missing of [
      { responsesChild: { ...first, requests: 1 } },
      { responsesChild: { ...first, teardownMs: 4000 } },
      { responsesChild: { ...first, closedMs: 4000 } },
      { responsesChild: { ...first, streams: [] } },
      { responsesChild: { ...first, closed: false } },
      { responsesFollowup: { ...next, requests: 1 } },
      { responsesFollowup: { ...next, completed: false } },
      { responsesFollowup: { ...next, closed: false } },
      { responsesFollowup: { ...next, tornDown: false } },
      { responsesFollowup: { ...next, lastTeardown: false } },
      { responsesFollowup: { ...next, streams: [{ ...stream, firstWriteMs: 3999 }, stream] } },
      { responsesFollowup: { ...next, streams: [{ ...stream, endedMs: 4500 }, stream] } },
    ]) {
      expect(outcomeOf({ ...run([]), waitReports: { ...covered, ...missing } })).toBe('unproven');
    }
  });
});
