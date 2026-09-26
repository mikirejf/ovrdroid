import { describe, expect, test } from 'bun:test';

import { describeNotice, noticeLostReport, readChildTurn, readNotice } from '../notice.ts';

const TOKEN = 'NOTICE-abc';

function message(role: string, content: unknown, visibility?: string): string {
  return JSON.stringify({
    type: 'message',
    message: { role, content, ...(visibility !== undefined && { visibility }) },
  });
}

function noticeText(output: string): string {
  return (
    `Background task completed.\ntask_id: child-1\ntype: explorer\nreason: completed\n` +
    `description: ${TOKEN}\noutput: ${output}\n\nBackground task "${TOKEN}" (child-1) just completed.`
  );
}

const CHILD = [
  JSON.stringify({ type: 'session_start', id: 'child-1' }),
  message('user', [{ type: 'text', text: '# Task Tool Invocation\n\nSubagent type: explorer' }]),
  message('assistant', [{ type: 'tool_use' }]),
  message('user', [], 'user_only'),
  message('user', [{ type: 'tool_result' }]),
  message('assistant', [{ type: 'text', text: `${TOKEN} done` }]),
];

describe('readNotice', () => {
  test('reads the task id and output of the notice naming the token', () => {
    const lines = [
      message('user', [{ type: 'text', text: 'launch it' }]),
      message('user', [{ type: 'text', text: noticeText('No output available') }], 'llm_only'),
    ];
    expect(readNotice(lines, TOKEN)).toEqual({ taskId: 'child-1', output: 'No output available' });
  });

  test('ignores a notice for another task', () => {
    const lines = [message('user', [{ type: 'text', text: noticeText('x') }], 'llm_only')];
    expect(readNotice(lines, 'NOTICE-other')).toBeUndefined();
  });

  test('keeps a multi-line report whole', () => {
    const lines = [message('user', [{ type: 'text', text: noticeText('one\ntwo') }], 'llm_only')];
    expect(readNotice(lines, TOKEN)?.output).toBe('one\ntwo');
  });
});

describe('readChildTurn', () => {
  test('finds the last report and counts hook records inside the turn', () => {
    expect(readChildTurn(CHILD)).toEqual({ report: `${TOKEN} done`, hookRecords: 1 });
  });

  test('says nothing without a task prompt', () => {
    expect(readChildTurn(CHILD.slice(2))).toBeUndefined();
  });
});

describe('verdict', () => {
  const child = { report: `${TOKEN} done`, hookRecords: 1 };

  test('an empty notice over a written report is the bug', () => {
    const reading = { notice: { taskId: 'child-1', output: 'No output available' }, child };
    expect(noticeLostReport(reading)).toBe(true);
    expect(describeNotice(reading)).toContain('the notice lost the report the subagent wrote');
  });

  test('a notice carrying the report passes', () => {
    const reading = { notice: { taskId: 'child-1', output: `${TOKEN} done` }, child };
    expect(noticeLostReport(reading)).toBe(false);
    expect(describeNotice(reading)).toContain('the notice carried the report');
  });

  test('a run with no hook record says it did not exercise the bug', () => {
    const reading = {
      notice: { taskId: 'child-1', output: `${TOKEN} done` },
      child: { ...child, hookRecords: 0 },
    };
    expect(describeNotice(reading)).toContain('did not exercise the bug');
  });
});
