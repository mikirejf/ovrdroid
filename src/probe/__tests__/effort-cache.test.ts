import { describe, expect, test } from 'bun:test';

import type { Message, MessagesRequest, SystemBlock } from '../anthropic.ts';
import { verdict } from '../effort-cache-verdict.ts';
import type { Send } from '../effort-cache.ts';
import {
  buildRequest,
  hasSignedThinking,
  headersFor,
  historyOf,
  MID_CONVERSATION_BETA,
  SAME_EFFORT,
  SEED_EFFORT,
  seedMessages,
  SWITCHED_EFFORT,
  SYSTEM_MESSAGE_SWITCH,
  TOP_LEVEL_SWITCH,
} from '../effort-cache.ts';
import { read, usage, wrote } from './usage.ts';

const CACHED = 20_122;
const RUN_ID = 'run-a';
const SIGNED_REPLY = [
  { type: 'thinking', thinking: '2^n mod 10^6 ...', signature: 'EqQBCkgIARABGAIi' },
  { type: 'text', text: 'n = 100000' },
];

function history(): Message[] {
  return historyOf(seedMessages(1000, RUN_ID), SIGNED_REPLY);
}

function cachedBlocks(runId: string): SystemBlock[] {
  const [first] = seedMessages(1000, runId);
  return first?.role === 'user' && typeof first.content !== 'string' ? first.content : [];
}

function cachedText(runId: string): string {
  return cachedBlocks(runId)
    .map((block) => block.text)
    .join('');
}

function requestFor(send: Send): MessagesRequest {
  return buildRequest({ model: 'm', messages: history(), send });
}

function switches(topLevel: number, perMessage: number) {
  return [
    { name: TOP_LEVEL_SWITCH.name, usage: usage({ read: topLevel, write: CACHED - topLevel }) },
    { name: SYSTEM_MESSAGE_SWITCH.name, usage: usage({ read: perMessage, write: 0 }) },
  ];
}

describe('verdict rules on each switch against the seed write', () => {
  test('a read at or above 90% kept the cache, below 10% re-wrote it', () => {
    const text = verdict({
      seed: wrote(CACHED),
      control: read(CACHED),
      switches: switches(0, 20_118),
    });
    expect(text).toBe(
      [
        'top-level switch re-wrote the cache: read 0, wrote 20,122',
        'system-message switch kept the cache: read 20,118 of 20,122 cached tokens',
      ].join('\n'),
    );
  });

  test('a read between the two lines partly kept it and says both numbers', () => {
    const text = verdict({
      seed: wrote(CACHED),
      control: read(CACHED),
      switches: switches(10_000, CACHED),
    });
    expect(text.split('\n')[0]).toBe(
      'top-level switch partly kept the cache: read 10,000 of 20,122 cached tokens, wrote 10,122',
    );
  });

  test('a control that missed means the switches cannot be judged', () => {
    const text = verdict({ seed: wrote(CACHED), control: wrote(CACHED), switches: switches(0, 0) });
    expect(text).toBe(
      'same effort read only 0 of 20,122 cached tokens, so the cache never warmed and the run cannot judge the switches',
    );
  });
});

describe('buildRequest moves effort one way per arm', () => {
  test('the system-message arm puts the effort message right before the last user turn', () => {
    const { messages } = requestFor(SYSTEM_MESSAGE_SWITCH);
    expect(messages.at(-2)).toEqual({
      role: 'system',
      content: [],
      output_config: { effort: SWITCHED_EFFORT },
    });
    expect(messages.at(-1)).toEqual(history().at(-1));
    expect(messages).toHaveLength(history().length + 1);
  });

  test('the system-message arm leaves the top-level effort alone', () => {
    expect(requestFor(SYSTEM_MESSAGE_SWITCH).output_config).toEqual({ effort: SEED_EFFORT });
  });

  test('the top-level arm changes only output_config.effort', () => {
    const { output_config: controlEffort, ...control } = requestFor(SAME_EFFORT);
    const { output_config: switchedEffort, ...switched } = requestFor(TOP_LEVEL_SWITCH);
    expect(controlEffort).toEqual({ effort: SEED_EFFORT });
    expect(switchedEffort).toEqual({ effort: SWITCHED_EFFORT });
    expect(switched).toEqual(control);
  });

  test('the seed reply goes into the history untouched, thinking signature included', () => {
    expect(history()[1]).toEqual({ role: 'assistant', content: SIGNED_REPLY });
  });

  test('cache_control sits on the filler block', () => {
    const [block] = cachedBlocks(RUN_ID);
    expect(block?.cache_control).toEqual({ type: 'ephemeral', ttl: '1h' });
    expect(block?.text).toContain('deterministic filler line');
  });
});

describe('seedMessages makes every run its own cached prefix', () => {
  test('two runs get different cached text', () => {
    expect(cachedText('run-a')).not.toBe(cachedText('run-b'));
  });

  test('the same run gets identical cached text, led by its run line', () => {
    expect(cachedText(RUN_ID)).toBe(cachedText(RUN_ID));
    expect(cachedText(RUN_ID).startsWith(`run ${RUN_ID}\n`)).toBe(true);
  });
});

describe('headersFor adds the mid-conversation beta only where it is needed', () => {
  test('it joins an existing anthropic-beta with a comma', () => {
    const base = { 'anthropic-beta': 'oauth-2025-04-20', 'x-api-key': 'k' };
    expect(headersFor(SYSTEM_MESSAGE_SWITCH, base)).toEqual({
      'anthropic-beta': `oauth-2025-04-20,${MID_CONVERSATION_BETA}`,
      'x-api-key': 'k',
    });
  });

  test('it sets the header when none was there and leaves other arms alone', () => {
    const base = { 'x-api-key': 'k' };
    expect(headersFor(SYSTEM_MESSAGE_SWITCH, base)['anthropic-beta']).toBe(MID_CONVERSATION_BETA);
    expect(headersFor(TOP_LEVEL_SWITCH, base)).toEqual(base);
  });
});

describe('hasSignedThinking', () => {
  test('a thinking block with a signature counts', () => {
    expect(hasSignedThinking(SIGNED_REPLY)).toBe(true);
  });

  test('an unsigned thinking block or plain text does not', () => {
    expect(hasSignedThinking([{ type: 'thinking', thinking: 'x', signature: '' }])).toBe(false);
    expect(hasSignedThinking([{ type: 'text', text: 'n' }])).toBe(false);
  });
});
