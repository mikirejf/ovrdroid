import { describe, expect, test } from 'bun:test';

import { FIXTURE_TOOL_NAME } from '../mcp-fixture.ts';
import {
  CHILD_WORD,
  describeWake,
  FIRST_WORD,
  launchesSubagent,
  LAUNCH_WORD,
  readWake,
  roleOf,
  WAKE_WORD,
  wakeFailures,
  wakePassed,
} from '../mcp-wake-report.ts';
import type { Role, WakeEvidence } from '../mcp-wake-report.ts';

const WITH_TASK = ['Read', 'Execute', 'ToolSearch', 'Task'];
const LOADED = [...WITH_TASK, FIXTURE_TOOL_NAME];

function textMessage(role: 'assistant' | 'user', text: string) {
  return { role, content: [{ type: 'text', text }] };
}

function useMessage(id: string, name: string, input: Record<string, string>) {
  return { role: 'assistant', content: [{ type: 'tool_use', id, name, input }] };
}

function resultMessage(id: string, content: string) {
  return { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content }] };
}

function deferredReminder(listed: boolean) {
  const names = ['WebSearch', ...(listed ? [FIXTURE_TOOL_NAME] : [])];
  return textMessage(
    'user',
    ['<system-reminder>', 'Deferred tools:', ...names, '</system-reminder>'].join('\n'),
  );
}

function body(tools: readonly string[], messages: readonly object[], listed = true) {
  return {
    tools: tools.map((name) => ({ name })),
    messages: [deferredReminder(listed), ...messages],
  };
}

const LAUNCH_PROMPT = textMessage('user', `${LAUNCH_WORD} run the sub-agent`);
const TASK_USE = useMessage('toolu_mcp_task', 'Task', {
  prompt: `${CHILD_WORD} call the fixture tool`,
});
const TASK_RESULT = resultMessage('toolu_mcp_task', 'done');
const FIRST_PROMPT = textMessage('user', `${FIRST_WORD} call the fixture tool`);
const WAKE_PROMPT = textMessage('user', `${WAKE_WORD} again`);
const AFTER_LAUNCH = [LAUNCH_PROMPT, TASK_USE, TASK_RESULT, textMessage('assistant', 'done')];

const PARENT_FIRST = body(WITH_TASK, [LAUNCH_PROMPT]);
const PARENT_AFTER_TASK = body(WITH_TASK, [LAUNCH_PROMPT, TASK_USE, TASK_RESULT]);
const CHILD_FIRST = body(WITH_TASK, [textMessage('user', `${CHILD_WORD} call the fixture tool`)]);
const CHILD_CALLED = body(LOADED, [
  textMessage('user', `${CHILD_WORD} call the fixture tool`),
  useMessage('toolu_mcp_call_sub', FIXTURE_TOOL_NAME, {}),
  resultMessage('toolu_mcp_call_sub', 'pong'),
]);
const FIRST_ASKED = body(WITH_TASK, [...AFTER_LAUNCH, FIRST_PROMPT]);

function firstCalled(content: string) {
  return body(LOADED, [
    ...AFTER_LAUNCH,
    FIRST_PROMPT,
    useMessage('toolu_mcp_call_first', FIXTURE_TOOL_NAME, {}),
    resultMessage('toolu_mcp_call_first', content),
  ]);
}

const AFTER_FIRST = [
  ...AFTER_LAUNCH,
  FIRST_PROMPT,
  useMessage('toolu_mcp_call_first', FIXTURE_TOOL_NAME, {}),
  resultMessage('toolu_mcp_call_first', 'pong'),
  textMessage('assistant', 'done'),
];
const WAKE_ASKED = body(LOADED, [...AFTER_FIRST, WAKE_PROMPT]);

function wakeCalled(content: string) {
  return body(LOADED, [
    ...AFTER_FIRST,
    WAKE_PROMPT,
    useMessage('toolu_mcp_call_wake', FIXTURE_TOOL_NAME, {}),
    resultMessage('toolu_mcp_call_wake', content),
  ]);
}

function staged(role: Role, ...bodies: object[]) {
  return bodies.map((one) => ({ role, body: one }));
}

function evidence(overrides: Partial<WakeEvidence> = {}): WakeEvidence {
  return {
    requests: [
      ...staged('launch', PARENT_FIRST, PARENT_AFTER_TASK),
      ...staged('child', CHILD_FIRST, CHILD_CALLED),
      ...staged('first', FIRST_ASKED, firstCalled('pong')),
      ...staged('wake', WAKE_ASKED, wakeCalled('pong')),
    ],
    childSawRunning: false,
    quietBeforeFirst: true,
    stoppedAfterMs: 2200,
    ...overrides,
  };
}

describe('roleOf tells the main agent from the sub-agent', () => {
  test('the first request of the main agent is the launch', () => {
    expect(roleOf(PARENT_FIRST)).toBe('launch');
  });

  test('the main agent after the Task call is still the launch, though its history carries the sub-agent prompt', () => {
    expect(roleOf(PARENT_AFTER_TASK)).toBe('launch');
  });

  test('a request opening with the sub-agent prompt is the sub-agent', () => {
    expect(roleOf(CHILD_FIRST)).toBe('child');
    expect(roleOf(CHILD_CALLED)).toBe('child');
  });

  test("each later prompt makes the main agent that prompt's role, whatever the history holds", () => {
    expect(roleOf(FIRST_ASKED)).toBe('first');
    expect(roleOf(firstCalled('pong'))).toBe('first');
    expect(roleOf(WAKE_ASKED)).toBe('wake');
    expect(roleOf(wakeCalled('pong'))).toBe('wake');
  });

  test('a completion notice after the Task call keeps the launch role and launches nothing', () => {
    const notice = body(WITH_TASK, [
      ...AFTER_LAUNCH,
      textMessage('user', 'Background task finished. task_id: abc, result: done'),
    ]);
    expect(roleOf(notice)).toBe('launch');
    expect(launchesSubagent(notice)).toBe(false);
  });

  test('a completion notice after the first prompt keeps the first role', () => {
    const notice = body(LOADED, [
      ...AFTER_FIRST,
      textMessage('user', 'Background task finished. task_id: abc, result: done'),
    ]);
    expect(roleOf(notice)).toBe('first');
  });

  test('a request with no tools, such as a title request, is plain', () => {
    expect(roleOf({ messages: [LAUNCH_PROMPT] })).toBe('plain');
  });
});

describe('launchesSubagent asks for one Task call per launch prompt', () => {
  test('the first request with Task offered launches', () => {
    expect(launchesSubagent(PARENT_FIRST)).toBe(true);
  });

  test('once the Task call is in the history it does not launch again', () => {
    expect(launchesSubagent(PARENT_AFTER_TASK)).toBe(false);
  });

  test('without the Task tool offered nothing can launch', () => {
    expect(launchesSubagent(body(['Read'], [LAUNCH_PROMPT]))).toBe(false);
  });
});

describe('wakeFailures names what the third session did not prove', () => {
  test('all good: sub-agent pong, first wake, idle stop after the idle time, pong after the stop', () => {
    const reading = readWake(evidence());
    expect(wakeFailures(reading)).toEqual([]);
    expect(wakePassed(reading)).toBe(
      "a sub-agent was offered ovrdroid-fixture's tools and got pong from a dormant server, the main agent's call then woke the server, the idle stop took it down 2.2s after that call (idle time 2.0s), and the next call woke it and got pong again",
    );
  });

  test('a stop just inside the slack still passes', () => {
    expect(wakeFailures(readWake(evidence({ stoppedAfterMs: 1500 })))).toEqual([]);
  });

  test('a stop sooner than idle time minus the slack is something other than the idle stop', () => {
    expect(wakeFailures(readWake(evidence({ stoppedAfterMs: 1400 })))).toEqual([
      'idle stop: the server was gone 1.4s after the call, before the 2.0s idle time: something other than the idle stop took it down',
    ]);
  });

  test('a teardown stop right after the call fails', () => {
    expect(wakeFailures(readWake(evidence({ stoppedAfterMs: 80 })))[0]).toContain(
      'something other than the idle stop took it down',
    );
  });

  test('a server still running at the time limit fails', () => {
    const reading = readWake(evidence({ stoppedAfterMs: undefined }));
    expect(wakeFailures(reading)).toEqual([
      "idle stop: ovrdroid-fixture was still running 17.0s after the main agent's call, with the idle time set to 2.0s",
    ]);
  });

  test('a sub-agent that was not offered the tool fails', () => {
    const lost = body(WITH_TASK, [textMessage('user', `${CHILD_WORD} go`)], false);
    const reading = readWake(
      evidence({
        requests: [...staged('launch', PARENT_FIRST, PARENT_AFTER_TASK), ...staged('child', lost)],
      }),
    );
    expect(wakeFailures(reading)).toEqual([
      "sub-agent: the model was not offered ovrdroid-fixture's tools while the server was dormant",
    ]);
  });

  test('a sub-agent offered the tool that got no pong fails and later steps are not blamed', () => {
    const reading = readWake(
      evidence({
        requests: [...staged('launch', PARENT_FIRST), ...staged('child', CHILD_FIRST, CHILD_FIRST)],
        quietBeforeFirst: false,
        stoppedAfterMs: undefined,
      }),
    );
    expect(wakeFailures(reading)).toEqual(['sub-agent: calling ping did not return pong']);
  });

  test('a sub-agent that met a running server did not see a dormant one', () => {
    expect(wakeFailures(readWake(evidence({ childSawRunning: true })))).toEqual([
      'sub-agent: ovrdroid-fixture was already running when the sub-agent started, so the sub-agent did not see a dormant server',
    ]);
  });

  test('main agent requests are not mistaken for sub-agent ones', () => {
    const reading = readWake(
      evidence({ requests: staged('launch', PARENT_FIRST, PARENT_AFTER_TASK, CHILD_CALLED) }),
    );
    expect(reading.child.requests).toBe(0);
    expect(wakeFailures(reading)).toEqual([
      'sub-agent: no request from a sub-agent reached the model, so the Task call never ran one',
    ]);
  });

  test('a sub-agent server still running before the first call means no first wake was shown', () => {
    expect(wakeFailures(readWake(evidence({ quietBeforeFirst: false })))).toEqual([
      "ovrdroid-fixture was still running 17.0s after the sub-agent finished, so the main agent's first call could not show a wake",
    ]);
  });

  test('the first call of the main agent getting no pong fails', () => {
    const reading = readWake(
      evidence({
        requests: [
          ...staged('child', CHILD_FIRST, CHILD_CALLED),
          ...staged('first', FIRST_ASKED, firstCalled('Not found')),
        ],
      }),
    );
    expect(wakeFailures(reading)).toEqual([
      "main agent's first call: calling ping did not return pong",
    ]);
  });

  test('no pong after the stop fails on the call', () => {
    const reading = readWake(
      evidence({
        requests: [
          ...staged('child', CHILD_FIRST, CHILD_CALLED),
          ...staged('first', FIRST_ASKED, firstCalled('pong')),
          ...staged('wake', WAKE_ASKED, wakeCalled('Not found')),
        ],
      }),
    );
    expect(wakeFailures(reading)).toEqual([
      'main agent after the stop: calling ping did not return pong',
    ]);
  });

  test('the pong to the first call does not count for the call after the stop', () => {
    const reading = readWake(
      evidence({
        requests: [
          ...staged('child', CHILD_FIRST, CHILD_CALLED),
          ...staged('first', FIRST_ASKED, firstCalled('pong')),
          ...staged('wake', WAKE_ASKED),
        ],
      }),
    );
    expect(reading.wake.ponged).toBe(false);
    expect(wakeFailures(reading)).toEqual([
      'main agent after the stop: calling ping did not return pong',
    ]);
  });
});

describe('describeWake says it in words', () => {
  test('one line per step', () => {
    expect(describeWake(readWake(evidence()))).toBe(
      [
        "one session with the idle time at 2.0s, Droid's own tool copy deleted:",
        '  sub-agent: ping listed in the deferred tools, pong came back, server dormant when it started',
        "  sub-agent finished: server gone before the main agent's first call",
        "  main agent's first call: ping listed in the deferred tools, pong came back",
        "  idle stop: the server stopped 2.2s after the main agent's call (idle time 2.0s)",
        '  main agent after the stop: ping offered as a tool, pong came back',
      ].join('\n'),
    );
  });

  test('a server that never stopped is said plainly', () => {
    const text = describeWake(readWake(evidence({ stoppedAfterMs: undefined })));
    expect(text).toContain("the server was still running 17.0s after the main agent's call");
  });

  test('a sub-agent that met a running server says so', () => {
    expect(describeWake(readWake(evidence({ childSawRunning: true })))).toContain(
      'server already running when it started',
    );
  });
});
