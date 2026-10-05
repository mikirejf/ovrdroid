import { afterAll, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { TRANSCRIPT_MAX_BYTES, TRANSCRIPT_TAIL_BYTES } from '../session-mention-patches.ts';
import { picker, transcript, userLine } from './session-mention-harness.ts';

const TYPED_AT = '2026-10-04T20:28:40.546Z';
const RESUMED_AT = '2026-10-05T08:23:17.194Z';

interface Content {
  type: string;
  text?: string;
  content?: string;
}

interface Message {
  role: string;
  content: readonly Content[];
  visibility?: string;
  hookEventName?: string;
}

function record(at: string, message: Message, pad = ''): string {
  return JSON.stringify({ type: 'message', id: 'r', timestamp: at, message, pad });
}

function said(at: string, text = 'done', pad = ''): string {
  return record(at, { role: 'assistant', content: [{ type: 'text', text }] }, pad);
}

function toolResult(at: string): string {
  return record(at, { role: 'user', content: [{ type: 'tool_result', content: 'ok' }] });
}

function resumeHook(at: string): string {
  return record(at, {
    role: 'user',
    content: [],
    visibility: 'user_only',
    hookEventName: 'SessionStart',
  });
}

describe('the last message ignores records Droid adds on resume', () => {
  const folder = mkdtempSync(path.join(tmpdir(), 'od-last-'));
  afterAll(() => {
    rmSync(folder, { recursive: true });
  });

  const write = (name: string, ...lines: string[]): string => {
    const file = path.join(folder, name);
    writeFileSync(file, transcript(...lines));
    return file;
  };

  test('a session resumed later still reports its last real message', () => {
    const file = write('resumed.jsonl', said(TYPED_AT, 'all done'), resumeHook(RESUMED_AT));
    expect(picker.$ODsessionLast(file)).toEqual({
      at: Date.parse(TYPED_AT),
      role: 'assistant',
      text: 'all done',
    });
  });

  test('a hook message between real ones is skipped', () => {
    const file = write(
      'hooked.jsonl',
      resumeHook(RESUMED_AT),
      said(TYPED_AT),
      resumeHook(RESUMED_AT),
    );
    expect(picker.$ODsessionLast(file)?.at).toBe(Date.parse(TYPED_AT));
  });

  test('the text comes from the last message that has text, the time from the last message', () => {
    const file = write(
      'tools.jsonl',
      said('2026-10-04T20:00:00.000Z', 'earlier words'),
      toolResult(TYPED_AT),
    );
    expect(picker.$ODsessionLast(file)).toEqual({
      at: Date.parse(TYPED_AT),
      role: 'assistant',
      text: 'earlier words',
    });
  });

  test('a user message is reported as the user', () => {
    const file = write(
      'user.jsonl',
      record(TYPED_AT, { role: 'user', content: [{ type: 'text', text: 'please stop' }] }),
    );
    expect(picker.$ODsessionLast(file)).toMatchObject({ role: 'user', text: 'please stop' });
  });

  test('system reminders do not count as text', () => {
    const file = write(
      'reminder.jsonl',
      said(TYPED_AT, 'real words <system-reminder>hidden</system-reminder>'),
    );
    expect(picker.$ODsessionLast(file)?.text).toBe('real words');
  });

  test('a real message found far from the end is still found', () => {
    const hooks = Array.from({ length: 4 }, () => resumeHook(RESUMED_AT));
    const file = write(
      'far.jsonl',
      said(TYPED_AT, 'far away', 'x'.repeat(TRANSCRIPT_TAIL_BYTES * 2)),
      ...hooks,
    );
    expect(picker.$ODsessionLast(file)).toMatchObject({
      at: Date.parse(TYPED_AT),
      text: 'far away',
    });
  });

  test('a session with no real message past the read cap reports nothing', () => {
    const file = write(
      'none.jsonl',
      said(TYPED_AT, 'too far', 'x'.repeat(TRANSCRIPT_MAX_BYTES + 10)),
      resumeHook(RESUMED_AT),
    );
    expect(picker.$ODsessionLast(file)).toBeNull();
  });

  test('a session with only tool results reports a time and no text', () => {
    const file = write('silent.jsonl', toolResult(TYPED_AT));
    expect(picker.$ODsessionLast(file)).toEqual({
      at: Date.parse(TYPED_AT),
      role: null,
      text: null,
    });
  });

  test('a session with only hook and context records reports nothing', () => {
    const file = write('empty.jsonl', resumeHook(RESUMED_AT));
    expect(picker.$ODsessionLast(file)).toBeNull();
  });

  test('a typed message without a timestamp is skipped', () => {
    const file = write('stamp.jsonl', said(TYPED_AT), userLine('no timestamp here'));
    expect(picker.$ODsessionLast(file)?.at).toBe(Date.parse(TYPED_AT));
  });

  test('a missing transcript reports nothing', () => {
    expect(picker.$ODsessionLast(path.join(folder, 'gone.jsonl'))).toBeNull();
  });
});
