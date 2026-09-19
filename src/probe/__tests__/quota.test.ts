import { describe, expect, test } from 'bun:test';

import { CLAUDE_CODE_SYSTEM } from '../anthropic.ts';
import type { ArmName, Crossing } from '../quota.ts';
import {
  buildRequest,
  checkArm,
  countedTokens,
  crossings,
  freshFiller,
  HEADER_5H,
  HEADER_7D,
  parseUtilization,
  verdict,
} from '../quota.ts';
import { usage } from './usage.ts';

const STEP_TOKENS = 30_204;
const FIRST_CROSSING = 181_224;
const SPAN = 211_428;
const SENDS_BEFORE_FIRST = 6;
const SENDS_PER_SPAN = 7;

function observed(spans: number): Crossing[] {
  const levels: number[] = Array.from({ length: SENDS_BEFORE_FIRST - 1 }, () => 0.16);
  for (let index = 0; index <= spans; index += 1) {
    const level = 0.17 + index / 100;
    const runLength = index === spans ? 1 : SENDS_PER_SPAN;
    for (let step = 0; step < runLength; step += 1) {
      levels.push(level);
    }
  }
  return levels.map((h5) => ({ tokens: STEP_TOKENS, h5 }));
}

function headerGet(map: Record<string, string>) {
  return (name: string): string | null => map[name] ?? null;
}

function blocksFor(arm: ArmName) {
  return buildRequest({ model: 'm', arm, text: 'filler' }).system;
}

describe('crossings turns a run of utilization readings into tokens per 1%', () => {
  test('the observed 1h run crosses at 181224 and spans 211428', () => {
    const result = crossings(observed(1));
    expect(result.crossings).toEqual([FIRST_CROSSING, FIRST_CROSSING + SPAN]);
    expect(result.spans).toEqual([SPAN]);
    expect(result.tokensPerPercent).toBe(SPAN);
  });

  test('three spans of the same size average to that size', () => {
    const result = crossings(observed(3));
    expect(result.crossings).toHaveLength(4);
    expect(result.spans).toEqual([SPAN, SPAN, SPAN]);
    expect(result.tokensPerPercent).toBe(SPAN);
  });

  test('one crossing yields no span and no mean', () => {
    const result = crossings(observed(0));
    expect(result.crossings).toEqual([FIRST_CROSSING]);
    expect(result.spans).toEqual([]);
    expect(result.tokensPerPercent).toBeUndefined();
  });

  test('a flat meter yields no crossings at all', () => {
    const flat = [
      { tokens: 100, h5: 0.16 },
      { tokens: 100, h5: 0.16 },
    ];
    expect(crossings(flat).crossings).toEqual([]);
  });

  test('a meter that falls back does not count as a crossing', () => {
    const falling = [
      { tokens: 100, h5: 0.2 },
      { tokens: 100, h5: 0.1 },
      { tokens: 100, h5: 0.1 },
    ];
    expect(crossings(falling).crossings).toEqual([]);
  });

  test('a meter that falls back is flagged so the spans are not trusted', () => {
    const falling = [
      { tokens: 100, h5: 0.2 },
      { tokens: 100, h5: 0.19 },
      { tokens: 100, h5: 0.2 },
      { tokens: 100, h5: 0.21 },
    ];
    const result = crossings(falling);
    expect(result.fell).toBe(true);
    expect(result.crossings).toEqual([400]);
  });

  test('a two percent jump splits its span in half', () => {
    const jump = [
      { tokens: 100, h5: 0.28 },
      { tokens: 100, h5: 0.29 },
      { tokens: 100, h5: 0.29 },
      { tokens: 100, h5: 0.29 },
      { tokens: 100, h5: 0.31 },
    ];
    const result = crossings(jump);
    expect(result.crossings).toEqual([200, 500]);
    expect(result.spans).toEqual([150]);
    expect(result.fell).toBe(false);
  });

  test('no records at all say so rather than throwing', () => {
    expect(crossings([])).toEqual({
      crossings: [],
      spans: [],
      tokensPerPercent: undefined,
      fell: false,
    });
  });

  test('uneven spans average out', () => {
    const uneven = [
      { tokens: 100, h5: 0.1 },
      { tokens: 100, h5: 0.11 },
      { tokens: 300, h5: 0.12 },
    ];
    const result = crossings(uneven);
    expect(result.crossings).toEqual([200, 500]);
    expect(result.tokensPerPercent).toBe(300);
  });
});

describe('countedTokens picks the token kind the arm is measuring', () => {
  test('the 1h and 5m arms count cache writes', () => {
    const wrote = usage({ write: 27_000, write1h: 27_000 });
    expect(countedTokens('1h', wrote)).toBe(27_000);
    expect(countedTokens('5m', wrote)).toBe(27_000);
  });

  test('the read arm counts cache reads', () => {
    expect(countedTokens('read', usage({ read: 27_000 }))).toBe(27_000);
  });

  test('the plain arm counts input tokens', () => {
    expect(countedTokens('plain', usage({ input: 30_000 }))).toBe(30_000);
  });
});

describe('checkArm proves the send did what the arm claims', () => {
  test('a 1h arm billed entirely at 1h passes', () => {
    expect(checkArm('1h', usage({ write: 27_000, write1h: 27_000 }))).toBeUndefined();
  });

  test('a 1h arm billed at 5m fails', () => {
    expect(checkArm('1h', usage({ write: 27_000, write5m: 27_000 }))).toContain(
      'did not write at 1h',
    );
  });

  test('a 1h arm that wrote nothing fails', () => {
    expect(checkArm('1h', usage({ read: 27_000 }))).toContain('wrote nothing');
  });

  test('a 5m arm billed entirely at 5m passes', () => {
    expect(checkArm('5m', usage({ write: 27_000, write5m: 27_000 }))).toBeUndefined();
  });

  test('a 5m arm upgraded to 1h fails', () => {
    expect(checkArm('5m', usage({ write: 27_000, write1h: 27_000 }))).toContain(
      'did not write at 5m',
    );
  });

  test('a read arm that only read passes', () => {
    expect(checkArm('read', usage({ read: 27_000 }))).toBeUndefined();
  });

  test('a read arm that read nothing fails', () => {
    expect(checkArm('read', usage({ write: 27_000, write1h: 27_000 }))).toContain('read nothing');
  });

  test('a read arm that also wrote fails', () => {
    expect(checkArm('read', usage({ read: 20_000, write: 7000, write1h: 7000 }))).toContain(
      'not a pure read',
    );
  });

  test('a plain arm with no cache traffic passes', () => {
    expect(checkArm('plain', usage({ input: 30_000 }))).toBeUndefined();
  });

  test('a plain arm that wrote fails', () => {
    expect(checkArm('plain', usage({ input: 2, write: 27_000 }))).toContain('not plain input');
  });

  test('a plain arm that read fails', () => {
    expect(checkArm('plain', usage({ input: 2, read: 27_000 }))).toContain('not plain input');
  });
});

describe('parseUtilization reads both meters off the response headers', () => {
  test('both headers come back as floats', () => {
    const get = headerGet({ [HEADER_5H]: '0.16', [HEADER_7D]: '0.05' });
    expect(parseUtilization(get)).toEqual({ h5: 0.16, h7: 0.05 });
  });

  test('a missing 5h header throws with the header name in the message', () => {
    const get = headerGet({ [HEADER_7D]: '0.05' });
    expect(() => parseUtilization(get)).toThrow(HEADER_5H);
  });

  test('a missing 7d header throws with the header name in the message', () => {
    const get = headerGet({ [HEADER_5H]: '0.16' });
    expect(() => parseUtilization(get)).toThrow(HEADER_7D);
  });

  test('a header that is not a number throws', () => {
    const get = headerGet({ [HEADER_5H]: 'lots', [HEADER_7D]: '0.05' });
    expect(() => parseUtilization(get)).toThrow(HEADER_5H);
  });
});

describe('buildRequest places cache_control where the arm needs it', () => {
  test('the first system block is the Claude Code line, uncached', () => {
    const blocks = blocksFor('1h');
    expect(blocks[0]).toEqual({ type: 'text', text: CLAUDE_CODE_SYSTEM });
    expect(blocks[0]).not.toHaveProperty('cache_control');
  });

  test('the 1h and read arms cache the filler at 1h', () => {
    expect(blocksFor('1h')[1]?.cache_control).toEqual({ type: 'ephemeral', ttl: '1h' });
    expect(blocksFor('read')[1]?.cache_control).toEqual({ type: 'ephemeral', ttl: '1h' });
  });

  test('the 5m arm caches the filler at 5m', () => {
    expect(blocksFor('5m')[1]?.cache_control).toEqual({ type: 'ephemeral', ttl: '5m' });
  });

  test('the plain arm carries no cache_control key at all', () => {
    const blocks = blocksFor('plain');
    expect(blocks[1]).toEqual({ type: 'text', text: 'filler' });
    expect(JSON.stringify(blocks[1])).not.toContain('cache_control');
  });

  test('every request asks for one token and says hi', () => {
    const request = buildRequest({ model: 'claude-fable-5-1', arm: 'plain', text: 'f' });
    expect(request.model).toBe('claude-fable-5-1');
    expect(request.max_tokens).toBe(1);
    expect(request.messages).toEqual([{ role: 'user', content: 'hi' }]);
  });
});

describe('freshFiller never repeats, so no send can hit the cache', () => {
  test('it grows with the token count at about 3.5 chars a token', () => {
    expect(freshFiller(1000)).toHaveLength(3500);
    expect(freshFiller(2000)).toHaveLength(7000);
  });

  test('two fillers of the same size differ', () => {
    expect(freshFiller(1000)).not.toBe(freshFiller(1000));
  });
});

describe('the verdict says what a percent of the quota costs', () => {
  test('four crossings report every span and the mean', () => {
    expect(verdict('1h', 'claude-fable-5-1', crossings(observed(3)))).toBe(
      'ARM 1h claude-fable-5-1: 4 crossings; tokens per 1% of the 5h quota: 211428, 211428, 211428; mean 211428',
    );
  });

  test('one crossing says the run stopped too early', () => {
    expect(verdict('read', 'claude-fable-5-1', crossings(observed(0)))).toBe(
      'ARM read claude-fable-5-1: 1 crossing; the run stopped before a span could be measured',
    );
  });

  test('no crossings say the run stopped too early too', () => {
    expect(verdict('plain', 'm', crossings([]))).toBe(
      'ARM plain m: 0 crossings; the run stopped before a span could be measured',
    );
  });

  test('a run where the meter fell says so after the numbers', () => {
    const fell = [
      { tokens: 100, h5: 0.1 },
      { tokens: 100, h5: 0.09 },
      { tokens: 100, h5: 0.11 },
      { tokens: 100, h5: 0.12 },
    ];
    expect(verdict('read', 'm', crossings(fell))).toBe(
      'ARM read m: 2 crossings; tokens per 1% of the 5h quota: 100; mean 100; the meter fell during the run, so older usage aged out and the spans read high',
    );
  });

  test('an uneven run reports a rounded mean', () => {
    const uneven = [
      { tokens: 100, h5: 0.1 },
      { tokens: 100, h5: 0.11 },
      { tokens: 300, h5: 0.12 },
      { tokens: 250, h5: 0.13 },
    ];
    expect(verdict('5m', 'm', crossings(uneven))).toBe(
      'ARM 5m m: 3 crossings; tokens per 1% of the 5h quota: 300, 250; mean 275',
    );
  });
});
