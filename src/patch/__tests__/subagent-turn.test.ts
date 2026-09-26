import { describe, expect, test } from 'bun:test';

import { patches } from '../patches.ts';

interface Message {
  id: string;
  role: 'user' | 'assistant' | 'tool';
  visibility?: 'user_only' | 'llm_only';
  content: { type: string; text?: string }[];
}

type TurnText = (messages: Message[], promptId: string) => string;

const patch = patches.find((entry) => entry.name === 'subagent-turn-ignores-hook-records');

if (patch === undefined) {
  throw new TypeError('subagent-turn-ignores-hook-records is missing from the patch list');
}

const REMINDER_OPEN = '<system-reminder>';
const REMINDER_CLOSE = '</system-reminder>';

const BOUNDARY =
  'function Bb(e){if(e.role!=="user")return!1;return!(e.visibility==="llm_only"&&e.content.length>0&&e.content.every((t)=>t.type==="text"&&U8(t.text.trim())))}';

const LAST_TEXT =
  'function yb(e){for(let o=e.length-1;o>=0;o--){let s=e[o];if(s.role!=="assistant")continue;' +
  'let r=s.content.filter((c)=>c.type==="text").map((c)=>c.text).join("").trim();if(r)return r}return""}';

function buildTurnText(body: string): TurnText {
  // SAFETY: the body is the patch payload, evaluated with the bindings the shipped
  // bundle gives it: `Bb` the turn-boundary test, `yb` the last assistant text.
  // oxlint-disable-next-line no-new-func, typescript/no-implied-eval, typescript/no-unsafe-type-assertion, typescript/no-unsafe-call
  return new Function(
    'O',
    'C',
    `function U8(e){return e.startsWith(O)&&e.endsWith(C)}${BOUNDARY}${LAST_TEXT}` +
      `return function(e,t){let o=e.findIndex((a)=>a.id===t);if(o===-1)return"";${body}`,
  )(REMINDER_OPEN, REMINDER_CLOSE) as TurnText;
}

const PROMPT: Message = {
  id: 'prompt',
  role: 'user',
  content: [{ type: 'text', text: '# Task Tool Invocation' }],
};
const TOOL_CALL: Message = { id: 'call', role: 'assistant', content: [{ type: 'tool_use' }] };
const HOOK_RECORD: Message = { id: 'hook', role: 'user', visibility: 'user_only', content: [] };
const TOOL_RESULT: Message = { id: 'result', role: 'tool', content: [{ type: 'tool_result' }] };
const REPORT: Message = {
  id: 'report',
  role: 'assistant',
  content: [{ type: 'text', text: 'the report' }],
};
const FOLLOW_UP: Message = {
  id: 'follow-up',
  role: 'user',
  content: [{ type: 'text', text: 'next prompt' }],
};
const LATER_REPORT: Message = {
  id: 'later',
  role: 'assistant',
  content: [{ type: 'text', text: 'the next turn' }],
};

const hookedTurn = [PROMPT, TOOL_CALL, HOOK_RECORD, TOOL_RESULT, REPORT];

const stock = buildTurnText(patch.find);
const patched = buildTurnText(patch.replace);

describe('the stock reader is the bug being fixed', () => {
  test('a hook record after the first tool call hides the report', () => {
    expect(stock(hookedTurn, PROMPT.id)).toBe('');
  });

  test('without a hook record the report is found', () => {
    expect(stock([PROMPT, TOOL_CALL, TOOL_RESULT, REPORT], PROMPT.id)).toBe('the report');
  });
});

describe('the patched reader reads past hook records', () => {
  test('the report after a hooked tool call is found', () => {
    expect(patched(hookedTurn, PROMPT.id)).toBe('the report');
  });

  test('a real follow-up prompt still ends the turn', () => {
    expect(patched([...hookedTurn, FOLLOW_UP, LATER_REPORT], PROMPT.id)).toBe('the report');
  });

  test('an unknown prompt id still reads as no text', () => {
    expect(patched(hookedTurn, 'missing')).toBe('');
  });
});
