import { describe, expect, test } from 'bun:test';

import {
  describeRun,
  describeTally,
  logEvents,
  mainTurnFor,
  outcomeOf,
  SCOPE_DISPOSED,
  turnFor,
  waitLaunches,
  waitCalls,
  waitLogReading,
  waitReportsExercised,
  WAIT_TIMEOUT_MS,
  childWorkDone,
  droidChurnEvents,
  droidChurnExercised,
} from '../scope-leak-report.ts';
import type { DroidChurnEvidence, LogEvent, ScopeLeakRun } from '../scope-leak-report.ts';
import { COVERED_REPORTS as COVERED } from '../scope-leak-test-fixtures.ts';

const PID = 4242;
const OTHER_PID = 777;
const SHUTDOWN_LINE = '[Tool] Task tool manager shutting down';
const TOOLS = [{ name: 'Task' }, { name: 'Execute' }];
type Block = Record<string, string>;
function user(content: string | Block[]) {
  return { role: 'user', content };
}
function run(events: LogEvent[], exited = false, binary = '/tmp/droid-a'): ScopeLeakRun {
  return { binary, exited, events };
}
const COMPLETION: LogEvent = { atMs: 1000, kind: 'completion' };
const SHUTDOWN: LogEvent = { atMs: 500, kind: 'shutdown' };
const CRASH: LogEvent = { atMs: 2800, kind: 'crash' };
describe('turnFor', () => {
  const work = user([{ type: 'tool_result', tool_use_id: 't1', content: 'scope-leak' }]);
  const notice = user([{ type: 'text', text: 'Background task done' }]);
  const quoted = user([
    { type: 'tool_result', tool_use_id: 't1', content: 'Background task started' },
  ]);
  test.each([
    { messages: [user('LAUNCH kept')], expected: 'launch' },
    { messages: [user('hold:kept')], expected: 'child-work' },
    {
      messages: [
        user('hold:kept'),
        { role: 'assistant', content: [{ type: 'tool_use', id: 't1', name: 'Execute' }] },
        work,
      ],
      expected: 'child',
    },
    { messages: [user('LAUNCH kept'), notice], expected: 'notice' },
    { messages: [user('LAUNCH kept'), quoted], expected: 'text' },
  ])(
    'classifies $expected without treating quoted notices as user notices',
    ({ messages, expected }) => {
      expect(turnFor({ tools: TOOLS, messages })).toBe(expected);
    },
  );
});
describe('mainTurnFor', () => {
  test('reads chat-completion bodies of the main session', () => {
    expect(mainTurnFor({ messages: [user('LAUNCH kept')] })).toBe('launch');
    expect(
      mainTurnFor({ messages: [user([{ type: 'text', text: 'Background task done' }])] }),
    ).toBe('notice');
    expect(
      mainTurnFor({ messages: [user('LAUNCH kept'), { role: 'tool', content: 'started' }] }),
    ).toBe('text');
    expect(mainTurnFor({ messages: [] })).toBe('text');
  });
});
describe('logEvents', () => {
  test('keeps only the window pid and joins continuation lines into their entry', () => {
    const log = [
      `[2026-10-26T18:00:00.000Z] INFO: ${SHUTDOWN_LINE} | {"process.pid":42420}`,
      `[2026-10-26T18:00:00.000Z] INFO: ${SHUTDOWN_LINE} | {"process.pid":${PID}}`,
      `[2026-10-26T18:00:00.500Z] INFO: notify | {"messageId":"task-completion:abc","process.pid":${PID}}`,
      `[2026-10-26T18:00:01.000Z] WARN: [Agent] Background process exit callback failed`,
      `AgentRuntimeScopeDisposedError: ${SCOPE_DISPOSED}`,
      `    at assertActive | {"process.pid":${PID}}`,
      `[2026-10-26T18:00:02.000Z] ERROR: CLI startup failed`,
      `AgentRuntimeScopeDisposedError: ${SCOPE_DISPOSED}`,
      `    at getService | {"process.pid":${PID}}`,
      `[2026-10-26T18:00:03.000Z] ERROR: CLI startup failed`,
      `AgentRuntimeScopeDisposedError: ${SCOPE_DISPOSED} | {"process.pid":${OTHER_PID}}`,
      `[2026-10-26T18:00:04.000Z] INFO: CLI startup failed | {"process.pid":${PID}}`,
    ].join('\n');
    expect(logEvents(log, PID)).toEqual([
      { atMs: Date.parse('2026-10-26T18:00:00.000Z'), kind: 'shutdown' },
      { atMs: Date.parse('2026-10-26T18:00:00.500Z'), kind: 'completion' },
      { atMs: Date.parse('2026-10-26T18:00:01.000Z'), kind: 'late-callback' },
      { atMs: Date.parse('2026-10-26T18:00:02.000Z'), kind: 'crash' },
    ]);
  });
});
describe('outcomeOf', () => {
  test('the scope crash counts even when the run saw nothing else', () => {
    expect(outcomeOf(run([CRASH], true))).toBe('crashed');
  });
  test('a live window after completion and shutdown survived', () => {
    expect(outcomeOf(run([SHUTDOWN, COMPLETION]))).toBe('survived');
  });
  test('a window that exited for another reason, or a sub-agent that never finished, proves nothing', () => {
    expect(outcomeOf(run([SHUTDOWN, COMPLETION], true))).toBe('unproven');
    expect(outcomeOf(run([COMPLETION]))).toBe('unproven');
  });
});
describe('describeRun', () => {
  test('says when the window died relative to the completion notice', () => {
    expect(describeRun(run([SHUTDOWN, COMPLETION, CRASH], true))).toBe(
      `the window exited with "${SCOPE_DISPOSED}", 1.8s after the completion notice; its task manager shut down, -0.5s after the completion notice`,
    );
  });
  test('counts late callbacks that hit the disposed scope', () => {
    expect(
      describeRun(run([SHUTDOWN, COMPLETION, { atMs: 1200, kind: 'late-callback' }])),
    ).toContain('1 late callback(s) hit the disposed scope');
  });
});
describe('describeTally', () => {
  test('tallies each binary on its own line', () => {
    const runs = [
      run([CRASH], true, '/tmp/patched'),
      run([SHUTDOWN, COMPLETION], false, '/tmp/stock'),
      run([SHUTDOWN, COMPLETION, CRASH], true, '/tmp/patched'),
    ];
    expect(describeTally(runs)).toBe(
      '/tmp/patched: crashed 2/2, survived 0, unproven 0\n/tmp/stock: crashed 0/1, survived 1, unproven 0',
    );
  });
});
type LogContext = Record<string, string | { sessionId: string }>;
function line(message: string, context: LogContext, pid = PID): string {
  return `[2026-11-10T12:00:00.000Z] INFO: ${message} | Context: ${JSON.stringify({ ...context, 'process.pid': pid })}`;
}
describe('blocking reports', () => {
  test('a Script-only warning after the Execute result must not repeat the child work', () => {
    expect(childWorkDone({ messages: [user('hold:scope1')] })).toBe(false);
    expect(
      childWorkDone({
        messages: [
          user('hold:scope1'),
          user([{ type: 'tool_result', tool_use_id: 'toolu_work_run_1', content: 'scope-leak' }]),
          user('Execute belongs inside Script'),
        ],
      }),
    ).toBe(true);
  });
  test('launches only local probe droids with unique deterministic prompts', () => {
    const calls = waitLaunches('run');
    expect(calls).toHaveLength(14);
    expect(new Set(calls.map((call) => call.input['prompt'])).size).toBe(14);
    expect(
      calls.filter((call) => call.input['subagent_type'] === 'ovrdroid-scope-wait-quick'),
    ).toHaveLength(11);
    expect(
      calls.filter((call) => call.input['subagent_type'] === 'ovrdroid-scope-wait-held'),
    ).toHaveLength(3);
  });
  test('waits use actual successful launch results in launch order, not invented task IDs', () => {
    const results = waitLaunches('run')
      .map((call, index) => ({
        type: 'tool_result',
        tool_use_id: call.id,
        content: `Task started\ntask_id: actual-${index}\nsession_id: actual-${index}`,
      }))
      .toReversed();
    const calls = waitCalls({ messages: [user(results)] }, 'run');
    expect(calls).toHaveLength(14);
    expect(calls.map((call) => call.input)).toEqual(
      Array.from({ length: 14 }, (_, index) => ({
        task_id: `actual-${index}`,
        block: true,
        timeout: WAIT_TIMEOUT_MS,
      })),
    );
    expect(() => waitCalls({ messages: [user(results.slice(1))] }, 'run')).toThrow(
      'no successful Task launch result',
    );
    expect(() => waitCalls({ messages: [user(results)] }, 'another-run')).toThrow();
  });
  test('every required coverage count and the post-teardown ticker window must be exercised', () => {
    expect(waitReportsExercised(COVERED)).toBe(true);
    for (const key of [
      'launched',
      'waitsStarted',
      'waitsFinished',
      'completed',
      'tornDown',
      'heldPending',
      'quickReplies',
      'closedHosts',
      'observedAfterTeardownMs',
    ] as const) {
      expect(waitReportsExercised({ ...COVERED, [key]: COVERED[key] - 1 })).toBe(false);
    }
    expect(waitReportsExercised({ ...COVERED, mainState: 'idle' })).toBe(false);
    expect(outcomeOf({ ...run([]), waitReports: COVERED })).toBe('survived');
    expect(
      outcomeOf({ ...run([COMPLETION, SHUTDOWN]), waitReports: { ...COVERED, tornDown: 10 } }),
    ).toBe('unproven');
  });
  test('counts distinct actual child teardowns and notices, retaining only the target pid and main state', () => {
    const shutdown = line(SHUTDOWN_LINE, { tags: { sessionId: 'child1' } });
    const reading = waitLogReading(
      [
        shutdown,
        shutdown,
        line(SHUTDOWN_LINE, { sessionId: 'child2' }, OTHER_PID),
        line(SHUTDOWN_LINE, { sessionId: 'main' }),
        line('notify', { messageId: 'task-completion:child1:turn' }),
        line('[Daemon] Droid working state changed', {
          sessionId: 'main',
          value: 'executing_tool',
        }),
        line('[Daemon] Droid working state changed', { sessionId: 'child1', value: 'idle' }),
        line(
          '[Daemon] Droid working state changed',
          { sessionId: 'main', value: 'idle' },
          OTHER_PID,
        ),
      ].join('\n'),
      PID,
      { main: 'main', children: ['child1', 'child2'] },
    );
    expect(reading).toEqual({
      tornDown: 1,
      completed: 1,
      mainState: 'executing_tool',
      closedHosts: 0,
      lastTeardownMs: Date.parse('2026-11-10T12:00:00.000Z'),
      closedChildren: [],
      lastTornDownChild: 'child1',
      teardowns: { child1: Date.parse('2026-11-10T12:00:00.000Z') },
      hostCloses: {},
    });
  });
});
describe('project droid churn', () => {
  test('requires a project file event and later update from the parent pid for the exact name', () => {
    const change = '[Tool] Droid file change detected';
    const update = '[Tool] Task tool registration applied';
    const context = { tags: { sessionId: 'main' }, location: 'project', name: 'unused.md' };
    expect(
      droidChurnEvents(
        [
          line(change, context),
          line(change, context, OTHER_PID),
          line(change, { ...context, location: 'personal' }),
          line(change, { ...context, name: 'different.md' }),
          line(update, { ...context, state: 'registered' }),
          line(update, { ...context, state: 'updated' }),
        ].join('\n'),
        PID,
        'unused.md',
      ),
    ).toEqual([
      { atMs: Date.parse('2026-11-10T12:00:00.000Z'), kind: 'file-change', sessionId: 'main' },
      { atMs: Date.parse('2026-11-10T12:00:00.000Z'), kind: 'registration', sessionId: 'main' },
    ]);
  });
  test('writes alone, child-only events or one coalesced reload cannot prove three stages', () => {
    const evidence: DroidChurnEvidence = {
      main: 'main',
      file: '/tmp/project/.factory/droids/unused.md',
      mutations: [
        { atMs: 1000, phase: 'before-first-reply', action: 'add' },
        { atMs: 2000, phase: 'after-first-teardown', action: 'remove' },
        { atMs: 3000, phase: 'after-last-teardown', action: 'add' },
      ],
      events: [1000, 2000, 3000].flatMap((atMs) => [
        { atMs: atMs + 10, kind: 'file-change' as const, sessionId: 'main' },
        { atMs: atMs + 510, kind: 'registration' as const, sessionId: 'main' },
      ]),
    };
    expect(droidChurnExercised(evidence)).toBe(true);
    expect(outcomeOf({ ...run([]), waitReports: COVERED, churnDroids: evidence })).toBe('survived');
    for (const events of [
      [],
      evidence.events.slice(2),
      evidence.events.filter((event) => event.kind === 'file-change'),
      evidence.events.map((event) => ({ ...event, sessionId: 'child' })),
    ]) {
      const missing = { ...evidence, events };
      expect(droidChurnExercised(missing)).toBe(false);
      expect(outcomeOf({ ...run([]), waitReports: COVERED, churnDroids: missing })).toBe(
        'unproven',
      );
    }
    expect(droidChurnExercised({ ...evidence, mutations: evidence.mutations.slice(1) })).toBe(
      false,
    );
  });
});
