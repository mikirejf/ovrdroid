import { describe, expect, test } from 'bun:test';

import { bodyPatches, BODIES_VARIABLE } from '../../patch/body-patches.ts';
import { WARM_MESSAGE_ID_PREFIX } from '../../patch/warmer-patches.ts';
import type { BodyRow, Json, JsonObject } from '../bodies.ts';
import { describeBodies, divergence, pairBodies, parseBodies, pathText } from '../bodies.ts';

const TOOLS = [
  { type: 'function', name: 'Read', parameters: {} },
  { type: 'function', name: 'Execute', parameters: {} },
];
const REMINDER = {
  role: 'user',
  content: [
    { type: 'input_text', text: '<system-reminder>subagents running: 1</system-reminder>' },
  ],
};
const ASK = { role: 'user', content: [{ type: 'input_text', text: 'run sleep' }] };
const ANSWER = { role: 'assistant', content: [{ type: 'output_text', text: 'ok' }] };

function body(input: readonly Json[], extra: JsonObject = {}): JsonObject {
  return { model: 'gpt', instructions: 'be brief', tools: TOOLS, input, stream: true, ...extra };
}

function row(assistantMessageId: string, payload: JsonObject): BodyRow {
  return {
    t: 0,
    sessionId: 's1',
    assistantMessageId,
    route: 'openai_responses',
    transport: 'http',
    body: payload,
  };
}

describe('divergence finds where a request stops extending the one before', () => {
  test('a pure append extends the old prompt', () => {
    expect(divergence(body([REMINDER, ASK]), body([REMINDER, ASK, ANSWER]))).toBeUndefined();
  });

  test('a change inside tools names the tool', () => {
    const changed = body([REMINDER, ASK], {
      tools: [
        { type: 'function', name: 'Read', parameters: {} },
        { type: 'function', name: 'Execute', parameters: {}, defer_loading: true },
      ],
    });
    const found = divergence(body([REMINDER, ASK]), changed);
    expect(found?.label).toBe('tools[1] (tool Execute)');
    expect(pathText(found?.path ?? [])).toBe('tools[1]');
  });

  test('a changed early message points into its text and says how far in', () => {
    const changedReminder = {
      role: 'user',
      content: [
        { type: 'input_text', text: '<system-reminder>subagents running: 0</system-reminder>' },
      ],
    };
    const found = divergence(body([REMINDER, ASK]), body([changedReminder, ASK, ANSWER]));
    expect(pathText(found?.path ?? [])).toBe('input[0].content[0].text');
    expect(found?.label).toBe('input[0] (the reminder block)');
    expect(found?.old).toContain('running: 1');
    expect(found?.new).toContain('running: 0');
    expect(found?.share).toBeGreaterThan(0.5);
    expect(found?.share).toBeLessThan(1);
  });

  test('settings after the prompt are reported apart from the prefix', () => {
    const [pairing] = pairBodies([
      row('a1', body([REMINDER, ASK], { reasoning: { effort: 'low' } })),
      row('a2', body([REMINDER, ASK, ANSWER], { max_output_tokens: 16 })),
    ]);
    expect(pairing?.divergence).toBeUndefined();
    expect(pairing?.settings).toEqual(['reasoning', 'max_output_tokens']);
  });
});

function wire(input: readonly Json[], tools: readonly Json[] = TOOLS): JsonObject {
  return {
    model: 'gpt',
    input,
    tools,
    instructions: 'be brief',
  };
}

describe('divergence compares in the order the cache reads, not the JSON order', () => {
  test('OpenAI: a new input item after the tools is an extension even though input comes first in the JSON', () => {
    expect(divergence(wire([REMINDER, ASK]), wire([REMINDER, ASK, ANSWER]))).toBeUndefined();
  });

  test('OpenAI: a tools change is found before any input', () => {
    const found = divergence(wire([REMINDER, ASK]), wire([REMINDER, ASK], TOOLS.slice(0, 1)));
    expect(pathText(found?.path ?? [])).toBe('tools');
  });

  test('Anthropic: tools, then system, then messages', () => {
    const anthropic = (system: string, messages: readonly Json[]): JsonObject => ({
      model: 'claude',
      max_tokens: 1,
      messages,
      tools: TOOLS,
      system: [{ type: 'text', text: system }],
    });
    expect(divergence(anthropic('sys', [ASK]), anthropic('sys', [ASK, ANSWER]))).toBeUndefined();
    const found = divergence(anthropic('sys', [ASK]), anthropic('other', [ASK]));
    expect(pathText(found?.path ?? [])).toBe('system[0].text');
  });
});

describe('pairBodies', () => {
  const rows = [
    row('a1', body([REMINDER, ASK])),
    row('a2', body([REMINDER, ASK, ANSWER])),
    row(`${WARM_MESSAGE_ID_PREFIX}1`, body([REMINDER, ASK, ANSWER])),
    row(`${WARM_MESSAGE_ID_PREFIX}2`, body([REMINDER, ASK, ANSWER])),
    row('a3', body([REMINDER, ASK, ANSWER, ASK])),
  ];

  test('each warm is paired with the last real request, never with a warm', () => {
    expect(pairBodies(rows).map((pairing) => `${pairing.newName}<${pairing.oldName}`)).toEqual([
      'request 2<request 1',
      'warm 1<request 2',
      'warm 2<request 2',
      'request 3<request 2',
    ]);
  });

  test('the report says it in words', () => {
    const changed = [row('a1', body([REMINDER, ASK])), row('a2', body([ASK]))];
    const text = describeBodies(changed).join('\n');
    expect(text).toContain('session s1');
    expect(text).toMatch(
      /request 2 changed input\[0\] \(the reminder block\) at char \d+, \d+% into request 1's prompt/u,
    );
  });
});

describe('parseBodies', () => {
  test('reads the lines the patch writes and skips blanks', () => {
    const line = JSON.stringify(row('a1', body([ASK])));
    expect(parseBodies(`${line}\n\n${line}\n`)).toHaveLength(2);
  });
});

describe('bodyPatches', () => {
  test('gate on the env variable and write synchronously', () => {
    const text = bodyPatches.map((patch) => patch.replace).join('');
    expect(text).toContain(`process.env.${BODIES_VARIABLE}`);
    expect(text).toContain('appendFileSync');
  });
});
