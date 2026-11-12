import { describe, expect, test } from 'bun:test';

import {
  answerFor,
  describeRoster,
  FIRST_CHILD_PROMPT,
  FIRST_CHILD_TITLE,
  LAUNCH_WORD,
  roleOf,
  ROSTER_TITLES,
  rosterVerdicts,
  SECOND_CHILD_PROMPT,
  SECOND_CHILD_TITLE,
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
    expect(roleOf(request({ first: LAUNCH_WORD }))).toBe('main');
  });

  test('the first child prompt identifies the first child', () => {
    expect(roleOf(request({ first: `${FIRST_CHILD_PROMPT}hold` }))).toBe('first-child');
  });

  test('the second child prompt identifies the second child', () => {
    expect(roleOf(request({ first: `${SECOND_CHILD_PROMPT}hold` }))).toBe('second-child');
  });

  test('later messages do not change the role', () => {
    const child = request({
      first: `${FIRST_CHILD_PROMPT}hold`,
      tail: [ASSISTANT, { role: 'user', content: [text(`${SECOND_CHILD_PROMPT}hold`)] }],
    });
    expect(roleOf(child)).toBe('first-child');
  });

  test('a message with none of the words is some other request', () => {
    expect(roleOf(request({ first: 'name this chat' }))).toBe('other');
  });

  test('a reminder block ahead of the prompt does not hide the prompt', () => {
    const body = {
      tools: [],
      messages: [
        { role: 'user', content: [REMINDER] },
        { role: 'user', content: [text(LAUNCH_WORD)] },
      ],
    };
    expect(roleOf(body)).toBe('main');
  });
});

describe('what the stub answers', () => {
  test('the main session launches both children, then says ok after the results', () => {
    expect(answerFor(request({ first: LAUNCH_WORD }))).toBe('launch-children');
    expect(answerFor(request({ first: LAUNCH_WORD, tail: [ASSISTANT, TOOL_RESULT] }))).toBe('ok');
  });

  test.each([FIRST_CHILD_PROMPT, SECOND_CHILD_PROMPT])('the child %s is held', (prompt) => {
    expect(answerFor(request({ first: `${prompt}hold` }))).toBe('hold');
    expect(answerFor(request({ first: `${prompt}hold`, tail: [ASSISTANT, TOOL_RESULT] }))).toBe(
      'hold',
    );
  });

  test('without the Task tool nothing is launched and both children stay held', () => {
    expect(answerFor(request({ first: LAUNCH_WORD, tools: ['Read'] }))).toBe('ok');
    for (const prompt of [FIRST_CHILD_PROMPT, SECOND_CHILD_PROMPT]) {
      expect(answerFor(request({ first: `${prompt}hold`, tools: ['Read'] }))).toBe('hold');
    }
  });
});

const MODEL = ROSTER_TITLES.model;

function screen(rows: string[]): string[] {
  return [
    `   Ovrdroid-roster-probe "${FIRST_CHILD_TITLE}"`,
    '╭──────╮',
    '│ Start new chat  2 droids │',
    '│   Filter agents │',
    ...rows,
    '╰──────╯',
  ];
}

const SIBLINGS = screen([
  `│ › ⠇ Ovrdroid-roster-probe: ${FIRST_CHILD_TITLE} · ${MODEL} (Dynamic)   now │`,
  `│   ⠇ Ovrdroid-roster-probe: ${SECOND_CHILD_TITLE} · ${MODEL} (Dynamic)   now │`,
]);

describe('the roster verdicts', () => {
  test('two sibling child rows with chips both pass', () => {
    const verdicts = rosterVerdicts(SIBLINGS, ROSTER_TITLES);
    expect(verdicts).toHaveLength(2);
    expect(verdicts.every((verdict) => verdict.pass)).toBe(true);
  });

  test('the transcript line above the list is not taken for the first child row', () => {
    const verdicts = rosterVerdicts(SIBLINGS, ROSTER_TITLES);
    expect(verdicts[0]?.text).toContain('Dynamic');
    const missing = rosterVerdicts(
      screen([`│   ⠇ Ovrdroid-roster-probe: ${SECOND_CHILD_TITLE} · ${MODEL} │`]),
      ROSTER_TITLES,
    );
    expect(missing.map((verdict) => verdict.pass)).toEqual([false, true]);
  });

  test.each([
    [FIRST_CHILD_TITLE, SECOND_CHILD_TITLE],
    [SECOND_CHILD_TITLE, FIRST_CHILD_TITLE],
  ])('a child row without the chip fails: %s', (missingChip, withChip) => {
    const lines = screen([
      `│ › ⠇ Ovrdroid-roster-probe: ${missingChip} │`,
      `│   ⠇ Ovrdroid-roster-probe: ${withChip} · ${MODEL} (Dynamic) │`,
    ]);
    const verdicts = rosterVerdicts(lines, ROSTER_TITLES);
    expect(verdicts.filter((verdict) => verdict.pass)).toHaveLength(1);
    expect(verdicts.find((verdict) => !verdict.pass)?.text).toContain('has no');
  });

  test('either sibling can be listed first', () => {
    const lines = screen([
      `│ › ⠇ Ovrdroid-roster-probe: ${SECOND_CHILD_TITLE} · ${MODEL} │`,
      `│   ⠇ Ovrdroid-roster-probe: ${FIRST_CHILD_TITLE} · ${MODEL} │`,
    ]);
    expect(rosterVerdicts(lines, ROSTER_TITLES).every((verdict) => verdict.pass)).toBe(true);
  });

  test('a missing second child row fails', () => {
    const lines = screen([`│ › ⠇ Ovrdroid-roster-probe: ${FIRST_CHILD_TITLE} · ${MODEL} │`]);
    const verdicts = rosterVerdicts(lines, ROSTER_TITLES);
    expect(verdicts.map((verdict) => verdict.pass)).toEqual([true, false]);
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
    const described = describeRoster(rosterVerdicts(SIBLINGS, ROSTER_TITLES));
    expect(described.split('\n').every((line) => line.startsWith('PASS'))).toBe(true);
  });
});
