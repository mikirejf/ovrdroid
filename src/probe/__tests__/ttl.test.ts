import { describe, expect, test } from 'bun:test';

import type { MessagesRequest, SystemBlock } from '../anthropic.ts';
import { parseUsage } from '../anthropic.ts';
import type { Price, SendStep, Step } from '../ttl.ts';
import {
  buildRequest,
  DEFAULT_MINUTES,
  estimateCost,
  filler,
  maxTokensFor,
  MAX_TOKENS_SLOW,
  SCHEDULES,
  sendSteps,
  SHORT_TTL_SECONDS,
  wallSeconds,
} from '../ttl.ts';
import { send } from './usage.ts';

const REAL_USAGE = {
  input_tokens: 2,
  cache_read_input_tokens: 0,
  cache_creation_input_tokens: 27_136,
  cache_creation: { ephemeral_5m_input_tokens: 0, ephemeral_1h_input_tokens: 27_136 },
  output_tokens: 4,
};

const NO_SPLIT_USAGE = {
  input_tokens: 2,
  cache_read_input_tokens: 27_136,
  cache_creation_input_tokens: 0,
  output_tokens: 4,
};

const MINUTE = 60;
const MILLION = 1_000_000;
const PRICE: Price = { input: 10, cacheRead: 0.25, cacheWrite5m: 12.5, cacheWrite1h: 20 };
const NOTHING: unknown = undefined;

function requestFor(step: SendStep, promptTokens = 2000): MessagesRequest {
  return buildRequest({ model: 'm', promptTokens, step, maxTokens: maxTokensFor(step) });
}

function blocksFor(step: SendStep, promptTokens = 2000): SystemBlock[] {
  return requestFor(step, promptTokens).system;
}

function textAt(blocks: readonly SystemBlock[], index: number): string {
  return blocks[index]?.text ?? '';
}

describe('parseUsage reads the Anthropic usage object', () => {
  test('a 1h write comes back with the whole split', () => {
    expect(parseUsage(REAL_USAGE)).toEqual({
      inputTokens: 2,
      cacheRead: 0,
      cacheWrite: 27_136,
      write5m: 0,
      write1h: 27_136,
      outputTokens: 4,
    });
  });

  test('a usage object with no cache_creation split reads as zeros', () => {
    expect(parseUsage(NO_SPLIT_USAGE)).toEqual({
      inputTokens: 2,
      cacheRead: 27_136,
      cacheWrite: 0,
      write5m: 0,
      write1h: 0,
      outputTokens: 4,
    });
  });

  test('something that is not a usage object is undefined, not a throw', () => {
    expect(parseUsage(NOTHING)).toBeUndefined();
    expect(parseUsage({ error: 'nope' })).toBeUndefined();
  });
});

describe('buildRequest places cache_control where the schedule needs it', () => {
  test('a plain send carries one ephemeral block with no ttl', () => {
    const blocks = blocksFor(send('5m'));
    expect(blocks).toHaveLength(1);
    expect(blocks[0]?.cache_control).toEqual({ type: 'ephemeral' });
  });

  test('a 1h send carries ttl 1h', () => {
    expect(blocksFor(send('1h'))[0]?.cache_control).toEqual({ type: 'ephemeral', ttl: '1h' });
  });

  test('a mixed send puts the 1h head before the 5m tail', () => {
    const blocks = blocksFor(send('mixed'));
    expect(blocks).toHaveLength(2);
    expect(blocks[0]?.cache_control).toEqual({ type: 'ephemeral', ttl: '1h' });
    expect(blocks[1]?.cache_control).toEqual({ type: 'ephemeral' });
    expect(textAt(blocks, 0).length).toBeGreaterThan(textAt(blocks, 1).length);
  });

  test('the mixed blocks rejoin into exactly the plain prompt', () => {
    const mixed = blocksFor(send('mixed'));
    expect(`${textAt(mixed, 0)}${textAt(mixed, 1)}`).toBe(textAt(blocksFor(send('5m')), 0));
  });

  test('a lead block goes in front uncached, so the cached prefix is unchanged', () => {
    const step = send('5m');
    const lead = buildRequest({
      model: 'm',
      promptTokens: 2000,
      step,
      maxTokens: maxTokensFor(step),
      leadText: 'You are Claude Code.',
    }).system;
    expect(lead).toHaveLength(2);
    expect(lead[0]?.cache_control).toBeUndefined();
    expect(textAt(lead, 0)).toBe('You are Claude Code.');
    expect(textAt(lead, 1)).toBe(textAt(blocksFor(step), 0));
  });

  test('two builds of the same spec are byte identical', () => {
    expect(JSON.stringify(requestFor(send('5m'), 5000))).toBe(
      JSON.stringify(requestFor(send('5m'), 5000)),
    );
  });

  test('the filler grows with the token count at about 3.5 chars a token', () => {
    expect(filler(1000)).toHaveLength(3500);
    expect(filler(2000)).toHaveLength(7000);
    expect(filler(2000).startsWith(filler(1000))).toBe(true);
  });

  test('a slow send asks for a long answer and gets a big max_tokens', () => {
    const request = requestFor(send('5m', true), 10);
    expect(request.max_tokens).toBe(MAX_TOKENS_SLOW);
    expect(request.messages[0]?.content).toContain('numbered list');
  });

  test('a fast send asks for ok and gets a tiny max_tokens', () => {
    const request = requestFor(send('5m'), 10);
    expect(request.max_tokens).toBe(5);
    expect(request.messages[0]?.content).toBe('Say ok.');
  });
});

describe('each schedule yields the steps its question needs', () => {
  test('cliff sends once then waits and sends for every minute in the list', () => {
    const steps = SCHEDULES.cliff({ minutes: DEFAULT_MINUTES });
    expect(sendSteps(steps)).toHaveLength(DEFAULT_MINUTES.length + 1);
    expect(steps[1]).toEqual({ kind: 'wait', seconds: 3 * MINUTE });
    expect(steps[2]).toEqual(send('5m'));
  });

  test('cliff honours a custom minute list', () => {
    expect(SCHEDULES.cliff({ minutes: [1, 2] })).toEqual([
      send('5m'),
      { kind: 'wait', seconds: MINUTE },
      send('5m'),
      { kind: 'wait', seconds: 2 * MINUTE },
      send('5m'),
    ]);
  });

  test('refresh is three 4m gaps then a 6m one', () => {
    const steps = SCHEDULES.refresh({ minutes: [] });
    const waits = steps.filter((step) => step.kind === 'wait').map((step) => step.seconds / MINUTE);
    expect(waits).toEqual([4, 4, 4, 6]);
    expect(sendSteps(steps)).toHaveLength(5);
  });

  test('clock-start opens with a slow send and waits just under the 5m TTL', () => {
    const steps = SCHEDULES['clock-start']({ minutes: [] });
    expect(steps[0]).toEqual(send('5m', true));
    expect(wallSeconds(steps)).toBe(4 * MINUTE);
    expect(wallSeconds(steps)).toBeLessThan(SHORT_TTL_SECONDS);
  });

  test('one-hour is two 1h sends around a 20m gap', () => {
    expect(SCHEDULES['one-hour']({ minutes: [] })).toEqual([
      send('1h'),
      { kind: 'wait', seconds: 20 * MINUTE },
      send('1h'),
    ]);
  });

  test('promote writes 5m, re-sends 1h, then checks after 20m', () => {
    const steps = SCHEDULES.promote({ minutes: [] });
    expect(sendSteps(steps).map((step) => step.ttl)).toEqual(['5m', '1h', '5m']);
    expect(wallSeconds(steps)).toBe(23 * MINUTE);
  });

  test('mixed sends the split prompt twice', () => {
    const steps = SCHEDULES.mixed({ minutes: [] });
    expect(sendSteps(steps).map((step) => step.ttl)).toEqual(['mixed', 'mixed']);
  });

  test('price is one write and one read of each kind with no waits', () => {
    const steps = SCHEDULES.price({ minutes: [] });
    expect(sendSteps(steps).map((step) => step.ttl)).toEqual(['5m', '5m', '1h', '1h']);
    expect(wallSeconds(steps)).toBe(0);
  });
});

describe('estimateCost is the worst case, every send writing', () => {
  test('two 5m writes of a million tokens each cost two write prices', () => {
    const steps: Step[] = [send('5m'), send('5m')];
    const outputs = (2 * 5 * PRICE.input) / MILLION;
    expect(estimateCost(steps, MILLION, PRICE)).toBeCloseTo(2 * PRICE.cacheWrite5m + outputs, 6);
  });

  test('a 1h write costs more than a 5m one of the same size', () => {
    expect(estimateCost([send('1h')], 10_000, PRICE)).toBeGreaterThan(
      estimateCost([send('5m')], 10_000, PRICE),
    );
  });

  test('a mixed send is billed three quarters at 1h and one quarter at 5m', () => {
    const outputs = (5 * PRICE.input) / MILLION;
    expect(estimateCost([send('mixed')], MILLION, PRICE)).toBeCloseTo(
      0.75 * PRICE.cacheWrite1h + 0.25 * PRICE.cacheWrite5m + outputs,
      6,
    );
  });

  test('waits cost nothing', () => {
    const withWait: Step[] = [send('5m'), { kind: 'wait', seconds: 600 }, send('5m')];
    expect(estimateCost(withWait, 10_000, PRICE)).toBe(
      estimateCost([send('5m'), send('5m')], 10_000, PRICE),
    );
  });
});
