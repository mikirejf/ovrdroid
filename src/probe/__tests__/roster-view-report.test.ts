import { describe, expect, test } from 'bun:test';

import {
  answerFor,
  CHILD_TITLE,
  describeRoster,
  GRANDCHILD_TITLE,
  indentOf,
  LEVEL_ONE,
  LEVEL_TWO,
  NEST_WORD,
  roleOf,
  ROSTER_TITLES,
  rosterVerdicts,
} from '../roster-view-report.ts';

const REMINDER = { type: 'text', text: '<system-reminder>Available tools</system-reminder>' };

function text(words: string) {
  return { type: 'text', text: words };
}

function request(options: {
  first: string;
  tools?: string[];
  tail?: { role: string; content: object[] }[];
}) {
  return {
    tools: (options.tools ?? ['Read', 'Task']).map((name) => ({ name })),
    messages: [{ role: 'user', content: [text(options.first)] }, ...(options.tail ?? [])],
  };
}

const TOOL_RESULT = { role: 'user', content: [{ type: 'tool_result', content: 'done' }] };
const ASSISTANT = { role: 'assistant', content: [{ type: 'tool_use', name: 'Task' }] };

describe('the stub tells the three droids apart by their opening message', () => {
  test('the prompt is the main session', () => {
    expect(roleOf(request({ first: NEST_WORD }))).toBe('main');
  });

  test('a level one prompt is the child', () => {
    expect(roleOf(request({ first: `${LEVEL_ONE}go` }))).toBe('child');
  });

  test('a level two prompt is the grandchild', () => {
    expect(roleOf(request({ first: `${LEVEL_TWO}hold` }))).toBe('grandchild');
  });

  test('later messages do not change the role', () => {
    const child = request({
      first: `${LEVEL_ONE}go`,
      tail: [ASSISTANT, { role: 'user', content: [text(`${LEVEL_TWO}hold`)] }],
    });
    expect(roleOf(child)).toBe('child');
  });

  test('a message with none of the words is some other request', () => {
    expect(roleOf(request({ first: 'name this chat' }))).toBe('other');
  });

  test('a reminder block ahead of the prompt does not hide the prompt', () => {
    const body = {
      tools: [],
      messages: [
        { role: 'user', content: [REMINDER] },
        { role: 'user', content: [text(NEST_WORD)] },
      ],
    };
    expect(roleOf(body)).toBe('main');
  });
});

describe('what the stub answers', () => {
  test('the main session launches the child, then says ok after the result', () => {
    expect(answerFor(request({ first: NEST_WORD }))).toBe('launch-child');
    expect(answerFor(request({ first: NEST_WORD, tail: [ASSISTANT, TOOL_RESULT] }))).toBe('ok');
  });

  test('the child launches the grandchild, then says hi after the result', () => {
    expect(answerFor(request({ first: `${LEVEL_ONE}go` }))).toBe('launch-grandchild');
    expect(answerFor(request({ first: `${LEVEL_ONE}go`, tail: [ASSISTANT, TOOL_RESULT] }))).toBe(
      'hi',
    );
  });

  test('the grandchild is held', () => {
    expect(answerFor(request({ first: `${LEVEL_TWO}hold` }))).toBe('hold');
  });

  test('without the Task tool nothing is launched', () => {
    expect(answerFor(request({ first: NEST_WORD, tools: ['Read'] }))).toBe('ok');
    expect(answerFor(request({ first: `${LEVEL_ONE}go`, tools: ['Read'] }))).toBe('hi');
  });
});

const MODEL = ROSTER_TITLES.model;

function screen(rows: string[]): string[] {
  return [
    `   Ovrdroid-roster-probe "${CHILD_TITLE}"`,
    '╭──────╮',
    '│ Start new chat  1 droid │',
    '│   Filter agents │',
    ...rows,
    '╰──────╯',
  ];
}

const NESTED = screen([
  `│ › ⠇ Ovrdroid-roster-probe: ${CHILD_TITLE} · ${MODEL} (Dynamic)   ▾ 1 subagent │`,
  '│     ↳ Waiting for 1 subagent │',
  `│       ⠇ Ovrdroid-roster-probe: ${GRANDCHILD_TITLE} · ${MODEL} (Dynamic)   now │`,
]);

describe('the roster verdicts', () => {
  test('a child and an indented grandchild with chips all pass', () => {
    const verdicts = rosterVerdicts(NESTED, ROSTER_TITLES);
    expect(verdicts).toHaveLength(3);
    expect(verdicts.every((verdict) => verdict.pass)).toBe(true);
  });

  test('the transcript line above the list is not taken for the child row', () => {
    const verdicts = rosterVerdicts(NESTED, ROSTER_TITLES);
    expect(verdicts[0]?.text).toContain('Dynamic');
  });

  test('a child row without the chip fails', () => {
    const lines = screen([
      `│ › ⠇ Ovrdroid-roster-probe: ${CHILD_TITLE}   ▾ 1 subagent │`,
      `│       ⠇ Ovrdroid-roster-probe: ${GRANDCHILD_TITLE} · ${MODEL} (Dynamic) │`,
    ]);
    const [child, grandchild] = rosterVerdicts(lines, ROSTER_TITLES);
    expect(child?.pass).toBe(false);
    expect(grandchild?.pass).toBe(true);
  });

  test('a grandchild at the same indent as the child is not nested', () => {
    const lines = screen([
      `│ › ⠇ Ovrdroid-roster-probe: ${CHILD_TITLE} · ${MODEL} │`,
      `│ › ⠇ Ovrdroid-roster-probe: ${GRANDCHILD_TITLE} · ${MODEL} │`,
    ]);
    const nested = rosterVerdicts(lines, ROSTER_TITLES).at(-1);
    expect(nested?.pass).toBe(false);
  });

  test('a grandchild listed above the child is not nested', () => {
    const lines = screen([
      `│       ⠇ Ovrdroid-roster-probe: ${GRANDCHILD_TITLE} · ${MODEL} │`,
      `│ › ⠇ Ovrdroid-roster-probe: ${CHILD_TITLE} · ${MODEL} │`,
    ]);
    expect(rosterVerdicts(lines, ROSTER_TITLES)[2]?.pass).toBe(false);
  });

  test('a missing grandchild row fails', () => {
    const lines = screen([`│ › ⠇ Ovrdroid-roster-probe: ${CHILD_TITLE} · ${MODEL} │`]);
    const verdicts = rosterVerdicts(lines, ROSTER_TITLES);
    expect(verdicts.map((verdict) => verdict.pass)).toEqual([true, false, false]);
    expect(verdicts[1]?.text).toContain('not on screen');
  });

  test('a screen without the list says the roster is not open', () => {
    const verdicts = rosterVerdicts(['   just the chat'], ROSTER_TITLES);
    expect(verdicts).toHaveLength(1);
    expect(verdicts[0]?.text).toContain('not open');
  });

  test('no screen at all fails', () => {
    expect(rosterVerdicts(undefined, ROSTER_TITLES)[0]?.pass).toBe(false);
  });

  test('the description marks each verdict', () => {
    const described = describeRoster(rosterVerdicts(NESTED, ROSTER_TITLES));
    expect(described.split('\n').every((line) => line.startsWith('PASS'))).toBe(true);
  });
});

describe('indentation', () => {
  test('borders, markers and spaces count, the title does not', () => {
    expect(indentOf('│ › ⠇ title')).toBe(4);
    expect(indentOf('│       ⠇ title')).toBe(8);
    expect(indentOf('title')).toBe(0);
  });
});
