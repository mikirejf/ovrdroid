import { describe, expect, test } from 'bun:test';

import { FIXTURE_TOOL_NAME } from '../mcp-fixture.ts';
import { nextModelCall, offerOf, readToolTurn, resultOf } from '../mcp-tool-turn.ts';

const BUILT_IN = [
  'Read',
  'LS',
  'Execute',
  'Edit',
  'Grep',
  'Glob',
  'Create',
  'TaskOutput',
  'TaskStop',
  'ToolSearch',
  'Skill',
  'Task',
];

function reminder(deferred: readonly string[]): string {
  return [
    '<system-reminder>',
    'Unified tool catalog:',
    'The tools listed below are available in this environment, but their schemas may be omitted from the current tool list to save context.',
    '',
    'Deferred tools:',
    ...deferred,
    '</system-reminder>',
  ].join('\n');
}

const OTHERS = ['WebSearch', 'FetchUrl', 'claude-artifacts-kit___authorize_upload'];

const SEARCH_USE = {
  role: 'assistant',
  content: [
    {
      type: 'tool_use',
      id: 'toolu_a',
      name: 'ToolSearch',
      input: { query: `select:${FIXTURE_TOOL_NAME}` },
    },
  ],
};

const SEARCH_RESULT = {
  role: 'user',
  content: [
    {
      type: 'tool_result',
      tool_use_id: 'toolu_a',
      content: `Loaded 1 tool(s): ${FIXTURE_TOOL_NAME}`,
      cache_control: { type: 'ephemeral' },
    },
  ],
};

const PING_USE = {
  role: 'assistant',
  content: [{ type: 'tool_use', id: 'toolu_b', name: FIXTURE_TOOL_NAME, input: {} }],
};

function pingResult(content: string, isError = false) {
  const block = { type: 'tool_result', tool_use_id: 'toolu_b', content };
  return { role: 'user', content: [isError ? { ...block, is_error: true } : block] };
}

function request(
  options: { tools?: readonly string[]; deferred: readonly string[] },
  ...rest: object[]
) {
  return {
    model: 'stub-mcp-tool',
    max_tokens: 8000,
    tools: (options.tools ?? BUILT_IN).map((name) => ({ name, description: 'x' })),
    messages: [
      {
        role: 'user',
        content: [
          { type: 'text', text: reminder(options.deferred) },
          { type: 'text', text: '<system-reminder>Current date: 2026-11-08.</system-reminder>' },
        ],
      },
      { role: 'user', content: [{ type: 'text', text: 'ping' }] },
      ...rest,
    ],
    stream: true,
  };
}

const DEFERRED = [...OTHERS.slice(0, 2), FIXTURE_TOOL_NAME, OTHERS[2] ?? ''];
const FIRST = request({ deferred: DEFERRED });
const SEARCHED = request(
  { deferred: DEFERRED, tools: [...BUILT_IN, FIXTURE_TOOL_NAME] },
  SEARCH_USE,
  SEARCH_RESULT,
);
const CALLED = request(
  { deferred: DEFERRED, tools: [...BUILT_IN, FIXTURE_TOOL_NAME] },
  SEARCH_USE,
  SEARCH_RESULT,
  PING_USE,
  pingResult('pong'),
);
const WITHOUT_TOOL = request({ deferred: OTHERS });
const TITLE = {
  model: 'stub-mcp-tool',
  messages: [{ role: 'user', content: [{ type: 'text', text: 'ping' }] }],
};

describe('offerOf says how the model can reach the tool', () => {
  test('a name in the deferred tools list is offered as deferred', () => {
    expect(offerOf(FIRST, FIXTURE_TOOL_NAME)).toBe('deferred');
  });

  test('a name in the tools array is offered as a tool', () => {
    expect(offerOf(SEARCHED, FIXTURE_TOOL_NAME)).toBe('tool');
  });

  test('a body that lists other tools only offers nothing', () => {
    expect(offerOf(WITHOUT_TOOL, FIXTURE_TOOL_NAME)).toBeUndefined();
  });

  test('a longer name that merely contains the tool name is not the tool', () => {
    const longer = request({ deferred: [`${FIXTURE_TOOL_NAME}_other`] });
    expect(offerOf(longer, FIXTURE_TOOL_NAME)).toBeUndefined();
  });

  test('the model saying the name in its own words does not count as an offer', () => {
    const talk = request(
      { deferred: OTHERS },
      { role: 'assistant', content: [{ type: 'text', text: FIXTURE_TOOL_NAME }] },
    );
    expect(offerOf(talk, FIXTURE_TOOL_NAME)).toBeUndefined();
  });
});

describe('nextModelCall calls the tool the way the request makes it callable', () => {
  test('a deferred tool is first loaded with ToolSearch select:<exact name>', () => {
    expect(nextModelCall(FIRST, FIXTURE_TOOL_NAME)).toMatchObject({
      name: 'ToolSearch',
      input: { query: `select:${FIXTURE_TOOL_NAME}` },
    });
  });

  test('once the tool is in the tools array it is called', () => {
    expect(nextModelCall(SEARCHED, FIXTURE_TOOL_NAME)).toMatchObject({
      name: FIXTURE_TOOL_NAME,
      input: {},
    });
  });

  test('a top-level tool is called at once', () => {
    const direct = request({ deferred: OTHERS, tools: [...BUILT_IN, FIXTURE_TOOL_NAME] });
    expect(nextModelCall(direct, FIXTURE_TOOL_NAME)?.name).toBe(FIXTURE_TOOL_NAME);
  });

  test('a search that did not load the tool is still followed by the call, so the failure shows', () => {
    const stuck = request({ deferred: DEFERRED }, SEARCH_USE, SEARCH_RESULT);
    expect(nextModelCall(stuck, FIXTURE_TOOL_NAME)?.name).toBe(FIXTURE_TOOL_NAME);
  });

  test('after the call the turn ends', () => {
    expect(nextModelCall(CALLED, FIXTURE_TOOL_NAME)).toBeUndefined();
  });

  test('a request that does not offer the tool ends the turn', () => {
    expect(nextModelCall(WITHOUT_TOOL, FIXTURE_TOOL_NAME)).toBeUndefined();
  });
});

describe('resultOf finds what the tool answered', () => {
  test('the result of the call, by its tool_use id', () => {
    expect(resultOf(CALLED, FIXTURE_TOOL_NAME)).toEqual({ text: 'pong', isError: false });
  });

  test('the ToolSearch result is not the tool result', () => {
    expect(resultOf(SEARCHED, FIXTURE_TOOL_NAME)).toBeUndefined();
  });
});

describe('readToolTurn reads what the model was offered and got back', () => {
  test('offered in the first request and ponged in a later one', () => {
    expect(readToolTurn([FIRST, SEARCHED, CALLED], FIXTURE_TOOL_NAME)).toEqual({
      requests: 3,
      offered: 'deferred',
      ponged: true,
    });
  });

  test('a body without the tool is not offered and cannot pong', () => {
    expect(readToolTurn([WITHOUT_TOOL], FIXTURE_TOOL_NAME)).toEqual({
      requests: 1,
      offered: undefined,
      ponged: false,
    });
  });

  test('a request with no tools, such as the title request, is not a turn', () => {
    expect(readToolTurn([TITLE, FIRST], FIXTURE_TOOL_NAME)).toMatchObject({
      requests: 1,
      offered: 'deferred',
    });
  });

  test('no requests at all reads as nothing asked', () => {
    expect(readToolTurn([], FIXTURE_TOOL_NAME)).toEqual({
      requests: 0,
      offered: undefined,
      ponged: false,
    });
  });

  test('an error result that mentions pong is not a pong', () => {
    const failed = request(
      { deferred: DEFERRED, tools: [...BUILT_IN, FIXTURE_TOOL_NAME] },
      PING_USE,
      pingResult('not pong: call failed', true),
    );
    expect(readToolTurn([FIRST, failed], FIXTURE_TOOL_NAME).ponged).toBe(false);
  });

  test('a call that came back with another answer is not a pong', () => {
    const wrong = request({ deferred: DEFERRED }, PING_USE, pingResult('Not found'));
    expect(readToolTurn([FIRST, wrong], FIXTURE_TOOL_NAME).ponged).toBe(false);
  });
});

describe('nextModelCall with a scope only counts what came after the latest prompt marker', () => {
  const scope = { marker: 'AGAIN', tag: 'wake' };
  const again = { role: 'user', content: [{ type: 'text', text: 'AGAIN please' }] };

  test('a ping answered before the marker does not end the new turn, and the new call has its own id', () => {
    const second = request({ deferred: DEFERRED }, PING_USE, pingResult('pong'), again);
    expect(nextModelCall(second, FIXTURE_TOOL_NAME)).toBeUndefined();
    expect(nextModelCall(second, FIXTURE_TOOL_NAME, scope)).toMatchObject({
      id: 'toolu_mcp_search_wake',
      name: 'ToolSearch',
    });
  });

  test('once the scoped call is in the history the turn ends', () => {
    const wakeUse = {
      role: 'assistant',
      content: [
        { type: 'tool_use', id: 'toolu_mcp_call_wake', name: FIXTURE_TOOL_NAME, input: {} },
      ],
    };
    const done = request({ deferred: DEFERRED }, PING_USE, pingResult('pong'), again, wakeUse);
    expect(nextModelCall(done, FIXTURE_TOOL_NAME, scope)).toBeUndefined();
  });

  test('a tool already in the tools array is called with the scoped id', () => {
    const direct = request({ deferred: OTHERS, tools: [...BUILT_IN, FIXTURE_TOOL_NAME] }, again);
    expect(nextModelCall(direct, FIXTURE_TOOL_NAME, scope)).toMatchObject({
      id: 'toolu_mcp_call_wake',
      name: FIXTURE_TOOL_NAME,
    });
  });
});
