import { describe, expect, test } from 'bun:test';

import { NO_MENTION_LINE, SUMMARIZE_LINE } from '../../patch/compaction-patches.ts';
import {
  bodyFormat,
  compactionKind,
  flatten,
  noClaimBody,
  noMentionBody,
  STOCK_SYSTEM_MARK,
  stockBody,
  stockUserContent,
  systemBody,
  THINKING_CHARS,
} from '../compaction-replay-bodies.ts';
import {
  askText,
  pick,
  responsesBody,
  responsesInput,
  reuseBody,
  reuseMessages,
  stockCaptured,
  SUMMARIZER,
  textAt,
} from './compaction-replay-harness.ts';

describe('compactionKind tells the two compaction paths apart', () => {
  test('a last user text block holding the summarize line is a reuse compaction', () => {
    expect(compactionKind(reuseBody())).toBe('reuse');
    expect(compactionKind(reuseBody('focus on tests'))).toBe('reuse');
  });

  test('the ask Claude models get, without "so do not mention it", is a reuse compaction too', () => {
    const text = askText('focus on tests').replace(SUMMARIZE_LINE, NO_MENTION_LINE);
    const messages = [
      ...reuseMessages().slice(0, -1),
      { role: 'user', content: [{ type: 'text', text }] },
    ];
    expect(compactionKind(reuseBody('', messages))).toBe('reuse');
    expect(
      textAt(stockBody(reuseBody('', messages)), 'messages', 0, 'content', 0, 'text'),
    ).toContain('for this summary:\nfocus on tests');
  });

  test('a system prompt with the summarizer wording is a stock compaction', () => {
    expect(compactionKind(stockCaptured())).toBe('stock');
  });

  test('an ordinary request is neither, with or without a system prompt', () => {
    const messages = [{ role: 'user', content: 'hello' }];
    expect(
      compactionKind({ system: [{ type: 'text', text: 'Be brief.' }], messages }),
    ).toBeUndefined();
    expect(compactionKind({ messages })).toBeUndefined();
  });

  test('the summarize line in an earlier message does not count', () => {
    const messages = [...reuseMessages(), { role: 'assistant', content: 'ok' }];
    expect(compactionKind(reuseBody('', messages))).toBeUndefined();
  });
});

describe('flatten follows the labels and layout of the summarizer transcript', () => {
  test('roles are upper case and messages are joined by a rule line', () => {
    expect(
      flatten([
        { role: 'user', content: 'hi' },
        { role: 'assistant', content: [{ type: 'text', text: 'hello' }] },
      ]),
    ).toBe('USER: hi\n\n---\n\nASSISTANT: hello');
  });

  test('tool calls and results carry their wire labels', () => {
    const text = flatten([
      { role: 'assistant', content: [{ type: 'tool_use', name: 'Read', input: { file: 'a.ts' } }] },
      {
        role: 'user',
        content: [
          { type: 'tool_result', content: 'plain' },
          { type: 'tool_result', content: [{ type: 'text', text: 'one' }, { type: 'image' }] },
        ],
      },
    ]);
    expect(text).toBe(
      'ASSISTANT: TOOL_CALL: Read input={"file":"a.ts"}\n\n---\n\nUSER: TOOL_RESULT: plain\nTOOL_RESULT: one\n[Image]',
    );
  });

  test('thinking is cut at 500 characters and empty thinking is dropped', () => {
    const long = 'x'.repeat(THINKING_CHARS + 1);
    const text = flatten([
      {
        role: 'assistant',
        content: [
          { type: 'thinking', thinking: '' },
          { type: 'thinking', thinking: long },
          { type: 'redacted_thinking' },
          { type: 'image' },
          { type: 'mystery' },
        ],
      },
    ]);
    expect(text).toBe(
      `ASSISTANT: [Thinking: ${'x'.repeat(THINKING_CHARS)}...]\n[Redacted thinking]\n[Image attached]\n[Unknown block type: mystery]`,
    );
  });
});

describe('stockBody rebuilds the request the stock path would send', () => {
  test('the system is the summarizer prompt alone and the tools are gone', () => {
    const body = stockBody(reuseBody());
    expect(body['system']).toEqual([{ type: 'text', text: SUMMARIZER }]);
    expect(body['tools']).toBeUndefined();
  });

  test('model, max_tokens, thinking and output_config carry over', () => {
    const body = stockBody(reuseBody());
    expect(body['model']).toBe('model-x');
    expect(body['max_tokens']).toBe(100);
    expect(body['thinking']).toEqual({ type: 'adaptive' });
    expect(body['output_config']).toEqual({ effort: 'medium' });
  });

  test('one cached user message holds every message but the last, flattened', () => {
    const body = stockBody(reuseBody());
    expect(pick(body, 'messages')).toHaveLength(1);
    expect(pick(body, 'messages', 0, 'role')).toBe('user');
    expect(pick(body, 'messages', 0, 'content', 0, 'cache_control')).toEqual({ type: 'ephemeral' });
    const text = textAt(body, 'messages', 0, 'content', 0, 'text');
    expect(text).toContain('USER: Fix the parser.');
    expect(text).toContain('TOOL_CALL: Read input={"file":"a.ts"}');
    expect(text).toContain('TOOL_RESULT: contents');
    expect(text).not.toContain(SUMMARIZE_LINE);
  });

  test('the content wraps the transcript the way the builder does', () => {
    expect(stockUserContent('T', '')).toBe(
      'Please summarize the following conversation:\n```\nT\n```\n\nRemember to wrap your final summary in <summary> tags.',
    );
  });

  test('custom instructions ride after the transcript, in the builder wording', () => {
    const body = stockBody(reuseBody('focus on tests'));
    const text = textAt(body, 'messages', 0, 'content', 0, 'text');
    expect(text).toContain(
      "```\n\nThe user has provided the following instructions for this summary:\nfocus on tests\n\nIf necessary, you may add new sections or modify existing ones to align with the user's intent.\n\nRemember to wrap",
    );
  });

  test('a body that is not a reuse compaction is refused', () => {
    expect(() => stockBody(stockCaptured())).toThrow('not a reuse compaction');
  });
});

const CLAIM =
  'This message is a system request, not part of the conversation, so do not mention it. ';
const REST = SUMMARIZE_LINE.slice(CLAIM.length);

function askOf(body: Parameters<typeof pick>[0]): string {
  return textAt(body, 'messages', 3, 'content', 0, 'text');
}

describe('noMentionBody drops the clause that tells the model not to mention the ask', () => {
  test('the first sentence loses ", so do not mention it" and nothing else changes', () => {
    const body = noMentionBody(reuseBody('focus on tests'));
    expect(askOf(body)).toBe(
      askText('focus on tests').replace(
        CLAIM,
        'This message is a system request, not part of the conversation. ',
      ),
    );
    expect(askOf(body)).toContain(REST);
    expect(pick(body, 'messages')).toHaveLength(4);
    expect(pick(body, 'messages', 0)).toEqual(reuseMessages()[0]);
    expect(body['tools']).toEqual([{ name: 'Read' }]);
  });
});

describe('noClaimBody swaps the first sentence for a plain instruction', () => {
  test('only that sentence changes', () => {
    const body = noClaimBody(reuseBody());
    expect(askOf(body)).toBe(askText().replace(CLAIM, 'Do not mention this request. '));
    expect(askOf(body)).toContain(REST);
  });
});

describe('systemBody sends the ask as a system message that removes every tool', () => {
  test('the last message is a system message: the ask text, then one tool_removal per tool', () => {
    const body = systemBody(reuseBody());
    expect(pick(body, 'messages', 3, 'role')).toBe('system');
    expect(pick(body, 'messages', 3, 'content')).toEqual([
      { type: 'text', text: askText() },
      { type: 'tool_removal', tool: { type: 'tool_reference', name: 'Read' } },
    ]);
    expect(pick(body, 'messages')).toHaveLength(4);
    expect(body['tools']).toEqual([{ name: 'Read' }]);
  });

  test('a body without tools gets the text block alone', () => {
    const { tools: _tools, ...bare } = reuseBody();
    expect(pick(systemBody(bare), 'messages', 3, 'content')).toEqual([
      { type: 'text', text: askText() },
    ]);
  });
});

function askIn(body: Parameters<typeof pick>[0]): string {
  return textAt(body, 'input', 3, 'content', 0, 'text');
}

describe('Responses bodies', () => {
  const claimed = askText('focus on tests');
  test('a last user input_text block holding the summarize line is a reuse compaction', () => {
    expect(compactionKind(responsesBody())).toBe('reuse');
    expect(compactionKind(responsesBody('focus on tests'))).toBe('reuse');
  });

  test('the ask without "so do not mention it" counts too', () => {
    const text = claimed.replace(SUMMARIZE_LINE, NO_MENTION_LINE);
    const input = [
      ...responsesInput().slice(0, -1),
      { role: 'user', content: [{ type: 'input_text', text }] },
    ];
    expect(compactionKind(responsesBody('', input))).toBe('reuse');
  });

  test('an ordinary request, or an ask in an earlier item, is not a compaction', () => {
    const input = [
      { role: 'user', content: [{ type: 'input_text', text: 'hello' }] },
      { role: 'assistant', content: [{ type: 'output_text', text: 'hi' }] },
    ];
    expect(compactionKind(responsesBody('', input))).toBeUndefined();
    expect(compactionKind(responsesBody('', [...responsesInput(), ...input]))).toBeUndefined();
  });

  test('a summarizer wording in the instructions never makes it a stock compaction', () => {
    const input = [{ role: 'user', content: [{ type: 'input_text', text: 'hello' }] }];
    const body = {
      ...responsesBody('', input),
      instructions: `You are Droid. ${STOCK_SYSTEM_MARK}.`,
    };
    expect(compactionKind(body)).toBeUndefined();
  });

  test('noMentionBody swaps the first sentence and leaves every other item and field alone', () => {
    const source = responsesBody('focus on tests');
    const body = noMentionBody(source);
    expect(askIn(body)).toBe(
      claimed.replace(CLAIM, 'This message is a system request, not part of the conversation. '),
    );
    expect(pick(body, 'input')).toHaveLength(4);
    expect(pick(body, 'input', 0)).toEqual(responsesInput()[0]);
    expect(pick(body, 'input', 1)).toEqual(responsesInput()[1]);
    expect(pick(body, 'input', 2)).toEqual(responsesInput()[2]);
    expect(pick(body, 'input', 3, 'role')).toBe('user');
    expect({ ...body, input: [] }).toEqual({ ...source, input: [] });
    expect(askIn(source)).toBe(claimed);
  });

  test('noClaimBody swaps the first sentence for a plain instruction', () => {
    expect(askIn(noClaimBody(responsesBody()))).toBe(
      askText().replace(CLAIM, 'Do not mention this request. '),
    );
  });

  test('a variant of a body whose ask is not one input_text block is refused', () => {
    const block = { type: 'input_text', text: askText() };
    const input = [...responsesInput().slice(0, 3), { role: 'user', content: [block, block] }];
    expect(() => noMentionBody(responsesBody('', input))).toThrow('exactly one text block');
    const messagesBlock = [{ type: 'text', text: askText() }];
    const wrong = [...responsesInput().slice(0, 3), { role: 'user', content: messagesBlock }];
    expect(() => noClaimBody(responsesBody('', wrong))).toThrow('exactly one text block');
  });

  test('systemBody and stockBody name the arm that needs a Messages body', () => {
    expect(() => systemBody(responsesBody())).toThrow(
      'the system arm needs a Messages-format body',
    );
    expect(() => stockBody(responsesBody())).toThrow('the stock arm needs a Messages-format body');
  });

  test('bodyFormat reads the list a body carries', () => {
    expect(bodyFormat(responsesBody())).toBe('responses');
    expect(bodyFormat(reuseBody())).toBe('messages');
    expect(bodyFormat({ model: 'm' })).toBeUndefined();
  });
});

describe('a variant never sends the unchanged ask', () => {
  const builders = [noMentionBody, noClaimBody, systemBody];

  test('a last message that is not a user message is refused', () => {
    const messages = [...reuseMessages().slice(0, 3), { role: 'assistant', content: 'ok' }];
    for (const build of builders) {
      expect(() => build(reuseBody('', messages))).toThrow('exactly one text block');
    }
  });

  test('a last message with two text blocks is refused', () => {
    const block = { type: 'text', text: askText() };
    const messages = [...reuseMessages().slice(0, 3), { role: 'user', content: [block, block] }];
    for (const build of builders) {
      expect(() => build(reuseBody('', messages))).toThrow('exactly one text block');
    }
  });

  test('string content is refused', () => {
    const messages = [...reuseMessages().slice(0, 3), { role: 'user', content: askText() }];
    for (const build of builders) {
      expect(() => build(reuseBody('', messages))).toThrow('exactly one text block');
    }
  });

  test('a text block without the summarize line is refused', () => {
    const messages = [
      ...reuseMessages().slice(0, 3),
      { role: 'user', content: [{ type: 'text', text: 'Summarize.' }] },
    ];
    for (const build of builders) {
      expect(() => build(reuseBody('', messages))).toThrow('summarize line');
    }
  });
});
