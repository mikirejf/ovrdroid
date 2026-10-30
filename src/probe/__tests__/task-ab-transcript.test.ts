import { describe, expect, test } from 'bun:test';

import { countTranscript, emptyCounts } from '../task-ab-transcript.ts';

interface Block {
  type: string;
  name?: string;
  text?: string;
  signature?: string;
  is_error?: boolean;
  content?: string;
}

interface Body {
  role: string;
  content: Block[];
  visibility?: string;
}

function message(body: Body): string {
  return JSON.stringify({ type: 'message', message: body });
}

function use(name: string): Block {
  return { type: 'tool_use', name };
}
function said(text: string): Block {
  return { type: 'text', text };
}

const TRANSCRIPT = [
  JSON.stringify({ type: 'session_start', id: 's' }),
  message({ role: 'user', content: [said('do it')] }),
  message({ role: 'assistant', content: [use('Read'), use('Grep')] }),
  message({ role: 'user', content: [{ type: 'tool_result', is_error: false, content: 'ok' }] }),
  message({ role: 'assistant', content: [use('Script')] }),
  message({ role: 'assistant', content: [use('Read'), use('Execute')], visibility: 'user_only' }),
  message({ role: 'assistant', content: [use('Read')], visibility: 'user_only' }),
  message({
    role: 'user',
    content: [{ type: 'tool_result', is_error: true, content: 'boom' }],
    visibility: 'user_only',
  }),
  message({ role: 'user', content: [{ type: 'tool_result', is_error: true, content: 'bad' }] }),
  message({ role: 'assistant', content: [use('TodoWrite'), use('Read')] }),
  message({ role: 'assistant', content: [{ type: 'thinking', signature: 'x' }] }),
  message({ role: 'assistant', content: [said('   ')] }),
  message({ role: 'assistant', content: [said('The code is 4711.')] }),
  JSON.stringify({ type: 'agent_turn_outcome', reason: 'completed' }),
].join('\n');

describe('countTranscript', () => {
  test('counts top-level requests, Read/Grep, Scripts and direct-only requests, calls nested in a Script, and failed tool results including nested ones', () => {
    expect(countTranscript(TRANSCRIPT)).toEqual({
      requests: 4,
      nested: 3,
      directReadGrep: 3,
      scripts: 1,
      directOnlyRequests: 2,
      toolErrors: 2,
    });
  });

  test('an empty transcript counts nothing', () => {
    expect(countTranscript('')).toEqual(emptyCounts());
  });
});
