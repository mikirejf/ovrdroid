import { describe, expect, test } from 'bun:test';

import { PROBE_SETTINGS } from '../launch.ts';
import {
  describeNotice,
  noticeSettings,
  noticeVerdict,
  readChildTurn,
  readNotice,
} from '../notice.ts';

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
  const carried = { taskId: 'child-1', output: `${TOKEN} done` };
  const empty = { taskId: 'child-1', output: 'No output available' };

  test('an empty notice over a written report is the bug', () => {
    const reading = { notice: empty, child };
    expect(noticeVerdict(reading)).toBe('lost');
    expect(describeNotice(reading)).toContain('the notice lost the report the subagent wrote');
  });

  test('a notice carrying the report, with a hook record in the turn, passes', () => {
    const reading = { notice: carried, child };
    expect(noticeVerdict(reading)).toBe('carried');
    expect(describeNotice(reading)).toContain('the notice carried the report');
  });

  test('a run with no hook record did not exercise the bug, so it does not pass', () => {
    const reading = { notice: carried, child: { ...child, hookRecords: 0 } };
    expect(noticeVerdict(reading)).toBe('unproven');
    expect(describeNotice(reading)).toContain('did not exercise the bug');
  });

  test('a lost report is the bug even when no hook record sat in the turn', () => {
    expect(noticeVerdict({ notice: empty, child: { ...child, hookRecords: 0 } })).toBe('lost');
  });

  test('a subagent that wrote no report proves nothing', () => {
    const reading = { notice: empty, child: { report: '', hookRecords: 1 } };
    expect(noticeVerdict(reading)).toBe('unproven');
    expect(describeNotice(reading)).toContain('did not exercise the bug');
  });

  test('a missing subagent transcript proves nothing', () => {
    expect(noticeVerdict({ notice: carried, child: undefined })).toBe('unproven');
  });
});

describe('noticeSettings', () => {
  const settings = noticeSettings();
  const [group] = settings.hooks.PreToolUse;

  test('hooks every Read the subagent makes, and the hook succeeds without output', () => {
    expect(group?.matcher).toBe('Read');
    const [hook] = group?.hooks ?? [];
    expect(hook?.type).toBe('command');
    const run = Bun.spawnSync(['sh', '-c', hook?.command ?? 'exit 99'], {
      stdin: Buffer.from('{"tool_name":"Read"}'),
    });
    expect(run.exitCode).toBe(0);
    expect(run.stdout.toString()).toBe('');
  });

  test('keeps the probe settings and the session hooks that own the ledger', () => {
    expect(settings.sessionDefaultSettings).toEqual(PROBE_SETTINGS.sessionDefaultSettings);
    expect(Object.keys(settings.hooks)).toEqual(['SessionStart', 'SessionEnd', 'PreToolUse']);
  });

  test('leaves the settings every other probe launches with untouched', () => {
    expect(Object.keys(PROBE_SETTINGS.hooks)).toEqual(['SessionStart', 'SessionEnd']);
  });
});
