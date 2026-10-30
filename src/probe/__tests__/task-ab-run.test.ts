import { describe, expect, test } from 'bun:test';

import { parseExecResult } from '../task-ab-run.ts';

const LINE = JSON.stringify({
  type: 'result',
  is_error: false,
  result: 'The code is 4711',
  session_id: 'abc',
  usage: {
    input_tokens: 6,
    output_tokens: 299,
    cache_read_input_tokens: 47_691,
    cache_creation_input_tokens: 9506,
  },
});

describe('parseExecResult', () => {
  test('finds the result line among other stdout lines', () => {
    expect(parseExecResult(`noise\n${LINE}\ntrailing noise\n`)).toEqual({
      sessionId: 'abc',
      reply: 'The code is 4711',
      isError: false,
      usage: { input: 6, cacheRead: 47_691, cacheWrite: 9506, output: 299 },
    });
  });

  test('has no result for output without a result line', () => {
    expect(parseExecResult('Error: not logged in\n')).toBeUndefined();
  });

  test('has no result for a result line without a session id', () => {
    expect(parseExecResult('{"type":"result","result":"x"}')).toBeUndefined();
  });
});
