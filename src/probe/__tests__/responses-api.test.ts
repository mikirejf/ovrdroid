import { describe, expect, test } from 'bun:test';

import { parseResponsesUsage, parseResponsesContent } from '../responses-api.ts';

describe('parseResponsesContent turns a Responses output into Messages-style blocks', () => {
  test('a message item gives one text block per output_text part', () => {
    const output = [
      { type: 'reasoning', summary: [] },
      {
        type: 'message',
        role: 'assistant',
        content: [
          { type: 'output_text', text: '<summary>one</summary>' },
          { type: 'refusal', refusal: 'no' },
          { type: 'output_text', text: 'two' },
        ],
      },
    ];
    expect(parseResponsesContent(output)).toEqual([
      { type: 'text', text: '<summary>one</summary>' },
      { type: 'text', text: 'two' },
    ]);
  });

  test('a function_call item gives a tool_use block with its name', () => {
    const output = [
      { type: 'message', content: [{ type: 'output_text', text: 'Reading.' }] },
      { type: 'function_call', name: 'Read', call_id: 'c1', arguments: '{}' },
    ];
    expect(parseResponsesContent(output)).toEqual([
      { type: 'text', text: 'Reading.' },
      { type: 'tool_use', name: 'Read' },
    ]);
  });

  test('an output that is not a list gives no blocks', () => {
    expect(parseResponsesContent(null)).toEqual([]);
    expect(parseResponsesContent([{ type: 'message' }])).toEqual([]);
  });
});

describe('parseResponsesUsage maps Responses usage to the cache fields', () => {
  test('cached tokens leave the input count and become the cache read', () => {
    expect(
      parseResponsesUsage({
        input_tokens: 1000,
        input_tokens_details: { cached_tokens: 900 },
        output_tokens: 50,
      }),
    ).toEqual({
      inputTokens: 100,
      cacheRead: 900,
      cacheWrite: 0,
      write5m: 0,
      write1h: 0,
      outputTokens: 50,
    });
  });

  test('missing cached_tokens counts as no cache read', () => {
    expect(parseResponsesUsage({ input_tokens: 1000, output_tokens: 50 })).toEqual({
      inputTokens: 1000,
      cacheRead: 0,
      cacheWrite: 0,
      write5m: 0,
      write1h: 0,
      outputTokens: 50,
    });
  });

  test('usage without input_tokens is no usage', () => {
    expect(parseResponsesUsage({ output_tokens: 5 })).toBeUndefined();
    expect(parseResponsesUsage(null)).toBeUndefined();
  });
});
