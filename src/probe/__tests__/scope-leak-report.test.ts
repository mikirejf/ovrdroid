import { describe, expect, test } from 'bun:test';

import {
  describeRun,
  describeTally,
  logEvents,
  mainTurnFor,
  outcomeOf,
  SCOPE_DISPOSED,
  turnFor,
} from '../scope-leak-report.ts';
import type { LogEvent, ScopeLeakRun } from '../scope-leak-report.ts';

const PID = 4242;
const OTHER_PID = 777;
const LONGER_PID = 42_420;
const SHUTDOWN_LINE = '[Tool] Task tool manager shutting down';
const TOOLS = [{ name: 'Task' }, { name: 'Execute' }];

interface Block {
  type: string;
  text?: string;
  tool_use_id?: string;
  content?: string;
}

function user(content: string | Block[]) {
  return { role: 'user', content };
}

interface Entry {
  stamp: string;
  message: string;
  pid: number;
  extra?: string;
}

function entry({ stamp, message, pid, extra = '' }: Entry): string {
  return `[${stamp}] INFO: ${message} | {"sessionId":"s1"${extra},"process.pid":${pid}}`;
}

function run(events: LogEvent[], exited = false, binary = '/tmp/droid-a'): ScopeLeakRun {
  return { binary, exited, events };
}

const COMPLETION: LogEvent = { atMs: 1000, kind: 'completion' };
const SHUTDOWN: LogEvent = { atMs: 500, kind: 'shutdown' };
const CRASH: LogEvent = { atMs: 2800, kind: 'crash' };

describe('turnFor', () => {
  test('a launch prompt with the Task tool launches the sub-agent', () => {
    expect(turnFor({ tools: TOOLS, messages: [user('LAUNCH kept')] })).toBe('launch');
  });

  test('the sub-agent first runs a command, then answers once its tool result is back', () => {
    expect(turnFor({ tools: TOOLS, messages: [user('hold:kept')] })).toBe('child-work');
    expect(
      turnFor({
        tools: TOOLS,
        messages: [
          user('hold:kept'),
          { role: 'assistant', content: [{ type: 'tool_use', id: 't1', name: 'Execute' }] },
          user([{ type: 'tool_result', tool_use_id: 't1', content: 'scope-leak' }]),
        ],
      }),
    ).toBe('child');
  });

  test('a turn whose last message is the completion notice is the notice turn', () => {
    expect(
      turnFor({
        tools: TOOLS,
        messages: [user('LAUNCH kept'), user([{ type: 'text', text: 'Background task done' }])],
      }),
    ).toBe('notice');
  });

  test('a tool result that quotes the notice is not the notice turn', () => {
    expect(
      turnFor({
        tools: TOOLS,
        messages: [
          user('LAUNCH kept'),
          user([{ type: 'tool_result', tool_use_id: 't1', content: 'Background task started' }]),
        ],
      }),
    ).toBe('text');
  });
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
      entry({ stamp: '2026-10-26T18:00:00.000Z', message: SHUTDOWN_LINE, pid: PID }),
      entry({
        stamp: '2026-10-26T18:00:00.500Z',
        message: '[JsonRpcAdapter] Emitting CREATE_MESSAGE notification',
        pid: PID,
        extra: ',"messageId":"task-completion:abc"',
      }),
      `[2026-10-26T18:00:01.000Z] WARN: [Agent] Background process exit callback failed`,
      `AgentRuntimeScopeDisposedError: ${SCOPE_DISPOSED}`,
      `    at assertActive | {"process.pid":${PID}}`,
      `[2026-10-26T18:00:02.000Z] ERROR: CLI startup failed`,
      `AgentRuntimeScopeDisposedError: ${SCOPE_DISPOSED}`,
      `    at getService | {"process.pid":${PID}}`,
      `[2026-10-26T18:00:03.000Z] ERROR: CLI startup failed`,
      `AgentRuntimeScopeDisposedError: ${SCOPE_DISPOSED} | {"process.pid":${OTHER_PID}}`,
      entry({ stamp: '2026-10-26T18:00:04.000Z', message: 'CLI startup failed', pid: PID }),
    ].join('\n');
    expect(logEvents(log, PID)).toEqual([
      { atMs: Date.parse('2026-10-26T18:00:00.000Z'), kind: 'shutdown' },
      { atMs: Date.parse('2026-10-26T18:00:00.500Z'), kind: 'completion' },
      { atMs: Date.parse('2026-10-26T18:00:01.000Z'), kind: 'late-callback' },
      { atMs: Date.parse('2026-10-26T18:00:02.000Z'), kind: 'crash' },
    ]);
  });

  test('a pid that is a prefix of another pid does not match it', () => {
    const log = entry({
      stamp: '2026-10-26T18:00:00.000Z',
      message: SHUTDOWN_LINE,
      pid: LONGER_PID,
    });
    expect(logEvents(log, PID)).toEqual([]);
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
