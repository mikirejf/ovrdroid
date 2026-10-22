import { describe, expect, test } from 'bun:test';

import {
  callerOf,
  childOf,
  finalReply,
  parentOf,
  replyCount,
  replyEfforts,
  toolResultCount,
  turnEnded,
  turnOutcome,
} from '../live-transcript.ts';

interface Block {
  type: string;
  text?: string;
}

interface Header {
  type: 'session_start';
  id: string;
  callingSessionId?: string;
}

interface Message {
  role: string;
  content: Block[];
  visibility?: string;
  reasoningEffort?: string;
}

function header(id: string, caller?: string): string {
  const record: Header = { type: 'session_start', id };
  if (caller !== undefined) {
    record.callingSessionId = caller;
  }
  return JSON.stringify(record);
}

function message(role: string, content: Block[], visibility?: string): string {
  const body: Message = { role, content };
  if (visibility !== undefined) {
    body.visibility = visibility;
  }
  return JSON.stringify({ type: 'message', message: body });
}

function reply(content: Block[], reasoningEffort: string): string {
  const body: Message = { role: 'assistant', content, reasoningEffort };
  return JSON.stringify({ type: 'message', message: body });
}

function text(value: string): Block {
  return { type: 'text', text: value };
}

const toolUse = { type: 'tool_use' } satisfies Block;
const toolResult = { type: 'tool_result' } satisfies Block;

function transcript(...lines: string[]): string {
  return lines.join('\n');
}

function outcome(reason: string): string {
  return JSON.stringify({ type: 'agent_turn_outcome', turnId: 't', reason, resultKind: 'text' });
}

describe('turnEnded waits for the outcome record Droid writes when a turn ends', () => {
  test('is true once the outcome follows the reply', () => {
    const done = transcript(
      header('p'),
      message('user', [text('go')]),
      message('assistant', [toolUse]),
      message('user', [toolResult]),
      message('assistant', [text('done')]),
      outcome('completed'),
    );
    expect(turnEnded(done)).toBe(true);
    expect(turnOutcome(done)).toBe('completed');
  });

  test('is true when the turn closes on a tool result with no text after it', () => {
    const closedPlan = transcript(
      header('p'),
      message('user', [text('go')]),
      message('assistant', [toolUse]),
      message('user', [toolResult]),
      message('assistant', [text('the answer')]),
      message('user', [text('<system-reminder>plan still open</system-reminder>')]),
      message('assistant', [toolUse]),
      message('user', [toolResult]),
      outcome('completed'),
    );
    expect(turnEnded(closedPlan)).toBe(true);
    expect(finalReply(closedPlan)).toBe('the answer');
  });

  test('is false for a text reply the outcome has not followed yet', () => {
    const replied = transcript(
      header('p'),
      message('assistant', [toolUse]),
      message('user', [toolResult]),
      message('assistant', [text('done')]),
    );
    expect(turnEnded(replied)).toBe(false);
  });

  test('an outcome from an earlier turn does not end the next one', () => {
    const next = transcript(
      header('p'),
      message('assistant', [text('one')]),
      outcome('completed'),
      message('user', [text('two')]),
    );
    expect(turnEnded(next)).toBe(false);
  });

  test('ignores hook records that land after the outcome', () => {
    const done = transcript(
      header('p'),
      message('assistant', [text('done')]),
      outcome('completed'),
      message('user', [], 'user_only'),
    );
    expect(turnEnded(done)).toBe(true);
  });

  test('reports a turn that ended without completing', () => {
    const failed = transcript(header('p'), message('assistant', [toolUse]), outcome('error'));
    expect(turnOutcome(failed)).toBe('error');
  });
});

describe('replyCount counts finished text replies, with or without tools', () => {
  test('it counts assistant text messages that call no tool', () => {
    const body = transcript(
      header('p'),
      message('user', [text('one')]),
      message('assistant', [text('one')]),
      message('user', [text('two')]),
      message('assistant', [text('working'), toolUse]),
      message('assistant', [text('two')]),
      message('user', [], 'user_only'),
    );
    expect(replyCount(body)).toBe(2);
  });

  test('it counts nothing while the assistant has not answered', () => {
    expect(replyCount(transcript(header('p'), message('user', [text('go')])))).toBe(0);
  });
});

describe('replyEfforts reads the effort each finished reply ran at', () => {
  test('it lists one effort per text reply, skipping tool-call messages', () => {
    const body = transcript(
      header('p'),
      message('user', [text('one')]),
      reply([text('one')], 'high'),
      message('user', [text('two')]),
      reply([text('working'), toolUse], 'xhigh'),
      reply([text('two')], 'medium'),
    );
    expect(replyEfforts(body)).toEqual(['high', 'medium']);
  });

  test('a reply without the field reads as an empty string', () => {
    expect(replyEfforts(transcript(header('p'), message('assistant', [text('one')])))).toEqual([
      '',
    ]);
  });
});

describe('transcript reading', () => {
  test('finalReply returns the last non-empty assistant text', () => {
    const body = transcript(
      header('c'),
      message('assistant', [text('first')]),
      message('assistant', [text('  last  ')]),
      message('assistant', [toolUse]),
    );
    expect(finalReply(body)).toBe('last');
  });

  test('toolResultCount counts results across messages', () => {
    const body = transcript(
      header('c'),
      message('user', [toolResult, toolResult]),
      message('user', [toolResult]),
    );
    expect(toolResultCount(body)).toBe(3);
  });

  test('callerOf reads the caller from the header, empty for a main session', () => {
    expect(callerOf(header('c', 'p'))).toBe('p');
    expect(callerOf(header('p'))).toBe('');
  });

  test('parentOf skips a header-only session and a subagent', () => {
    const empty = { id: 'e', text: header('e') };
    const child = {
      id: 'c',
      text: transcript(header('c', 'p'), message('assistant', [text('x')])),
    };
    const parent = { id: 'p', text: transcript(header('p'), message('assistant', [toolUse])) };
    expect(parentOf([empty, child, parent])).toBe(parent);
    expect(childOf([empty, child, parent], 'p')).toBe(child);
    expect(childOf([empty, parent], 'p')).toBeUndefined();
  });
});
