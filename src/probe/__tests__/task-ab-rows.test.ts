import { describe, expect, test } from 'bun:test';

import { parseRows, usageCost } from '../task-ab-rows.ts';
import { OPUS, row } from './task-ab-rows-harness.ts';

describe('usageCost', () => {
  const price = {
    droidId: OPUS,
    provider: 'anthropic',
    modelId: 'claude-opus-5-5',
    input: 5,
    output: 25,
    cacheRead: 0.5,
    cacheWrite5m: 6.25,
    cacheWrite1h: 10,
  };
  const usage = {
    input: 1_000_000,
    cacheRead: 1_000_000,
    cacheWrite: 1_000_000,
    output: 1_000_000,
  };

  test('prices every cache write as a 1 hour write', () => {
    expect(usageCost(price, usage)).toBeCloseTo(5 + 0.5 + 10 + 25);
  });

  test('falls back to the 5 minute write when there is no 1 hour price', () => {
    expect(usageCost({ ...price, cacheWrite1h: undefined }, usage)).toBeCloseTo(
      5 + 0.5 + 6.25 + 25,
    );
  });
});

describe('parseRows', () => {
  test('reads rows back from rows.jsonl text and skips lines that are not rows', () => {
    const text = `${JSON.stringify(row())}\n{"nope":1}\nnot json\n${JSON.stringify(row({ rep: 2 }))}\n`;
    expect(parseRows(text).map((parsed) => parsed.rep)).toEqual([1, 2]);
  });

  test('reads a row without a cost back', () => {
    const parsed = parseRows(JSON.stringify(row({ costUsd: null })));
    expect(parsed).toHaveLength(1);
    expect(parsed[0]?.costUsd).toBeNull();
  });
});
