import { describe, expect, test } from 'bun:test';

import {
  callerOf,
  childOf,
  finalReply,
  parentOf,
  toolResultCount,
  turnEnded,
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

function text(value: string): Block {
  return { type: 'text', text: value };
}

const toolUse = { type: 'tool_use' } satisfies Block;
const toolResult = { type: 'tool_result' } satisfies Block;

function transcript(...lines: string[]): string {
  return lines.join('\n');
}

describe('turnEnded tells a finished reply from a pause between tool calls', () => {
  test('is true when the last assistant message is text after a tool result', () => {
    const done = transcript(
      header('p'),
      message('user', [text('go')]),
      message('assistant', [toolUse]),
      message('user', [toolResult]),
      message('assistant', [text('done')]),
    );
    expect(turnEnded(done)).toBe(true);
  });

  test('is false while the last assistant message still calls a tool, even with text beside it', () => {
    const working = transcript(
      header('p'),
      message('user', [text('go')]),
      message('assistant', [text('reading next'), toolUse]),
    );
    expect(turnEnded(working)).toBe(false);
  });

  test('is false when the assistant answered without any tool result', () => {
    const talked = transcript(header('p'), message('assistant', [text('done')]));
    expect(turnEnded(talked)).toBe(false);
  });

  test('ignores hook records that land after the reply', () => {
    const done = transcript(
      header('p'),
      message('assistant', [toolUse]),
      message('user', [toolResult]),
      message('assistant', [text('done')]),
      message('user', [], 'user_only'),
    );
    expect(turnEnded(done)).toBe(true);
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
