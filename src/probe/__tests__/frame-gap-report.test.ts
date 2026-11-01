import { describe, expect, test } from 'bun:test';

import { anyFailed } from '../busy-signal-report.ts';
import {
  answerFor,
  blankRowsAtBottom,
  CHILD_WORD,
  frameGapVerdicts,
  MAIN_WORD,
  REPLY_LINES,
  replyLine,
} from '../frame-gap-report.ts';

const COLS = 40;
const ROWS = 6;

function lines(rows: readonly string[]): string {
  return rows.join('\r\n');
}

function history(): string[] {
  return Array.from({ length: REPLY_LINES }, (_line, index) => replyLine(index).slice(0, COLS - 1));
}

function evidence(...outputs: string[]) {
  return {
    cols: COLS,
    rows: ROWS,
    stages: outputs.map((output, index) => ({ name: `stage ${index}`, output })),
  };
}

describe('blankRowsAtBottom', () => {
  test('a frame ending on the row above the cursor row leaves one blank row', () => {
    expect(blankRowsAtBottom(lines([...history(), 'footer', '']), COLS, ROWS)).toBe(1);
  });

  test('a frame that ended higher leaves every row under it blank', () => {
    expect(blankRowsAtBottom(lines(['a', 'footer']), COLS, ROWS)).toBe(ROWS - 2);
  });
});

describe('frameGapVerdicts', () => {
  test('a frame on the bottom with every reply line once passes', () => {
    const verdicts = frameGapVerdicts(evidence(lines([...history(), 'footer', ''])));
    expect(anyFailed(verdicts)).toBe(false);
  });

  test('blank rows under the footer fail and say how many', () => {
    const output = `${lines([...history(), 'footer', ''])}\u001B[3A\u001B[J`;
    const verdicts = frameGapVerdicts(evidence(output));
    expect(anyFailed(verdicts)).toBe(true);
    expect(verdicts.at(-1)?.text).toContain('3 rows above the bottom');
  });

  test('a reply line shown twice is reported as repeated scrollback', () => {
    const output = lines([...history(), history()[2] ?? '', 'footer', '']);
    const verdicts = frameGapVerdicts(evidence(output));
    expect(verdicts.find((verdict) => !verdict.pass)?.text).toContain('repeats 1 reply lines');
  });

  test('a reply line missing is reported as lost', () => {
    const output = lines([...history().filter((_line, index) => index !== 5), 'footer', '']);
    const verdicts = frameGapVerdicts(evidence(output));
    expect(verdicts.find((verdict) => !verdict.pass)?.text).toContain('lost 1 reply lines');
  });

  test('a transcript that never filled the screen says nothing was tested', () => {
    const verdicts = frameGapVerdicts(evidence(lines(['hi', 'footer', ''])));
    expect(verdicts[0]?.pass).toBe(false);
    expect(verdicts[0]?.text).toContain('nothing was tested');
  });

  test('a run without stages fails', () => {
    expect(anyFailed(frameGapVerdicts(evidence()))).toBe(true);
  });
});

function user(text: string) {
  return { role: 'user', content: [{ type: 'text', text }] };
}

const TASK_TOOLS = [{ name: 'Task' }];

describe('answerFor', () => {
  test('the opening request launches the droid', () => {
    expect(answerFor({ messages: [user(MAIN_WORD)], tools: TASK_TOOLS })).toBe('launch');
  });

  test('the request carrying the tool result gets the long reply', () => {
    const messages = [
      user(MAIN_WORD),
      { role: 'assistant', content: [{ type: 'tool_use' }] },
      { role: 'user', content: [{ type: 'tool_result' }] },
    ];
    expect(answerFor({ messages, tools: TASK_TOOLS })).toBe('reply');
  });

  test('the child is held and other requests get a short answer', () => {
    expect(answerFor({ messages: [user(`${CHILD_WORD} hold`)] })).toBe('hold');
    expect(answerFor({ messages: [user('title this')] })).toBe('ok');
    expect(answerFor({ messages: [user(MAIN_WORD)] })).toBe('ok');
  });
});
