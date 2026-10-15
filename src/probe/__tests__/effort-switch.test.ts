import { describe, expect, test } from 'bun:test';

import type { SwitchOutcomes, TurnUsage } from '../effort-switch-verdict.ts';
import { bustsByTurn, switchVerdict, turnLine, turnUsage } from '../effort-switch-verdict.ts';
import type { BustLine, UsageLine } from '../logs.ts';

const MODEL = 'custom:droidproxy:sonnet-5-5';

function turn(cacheRead: number, cacheWrite: number): TurnUsage {
  return { input: 3, cacheRead, cacheWrite };
}

function outcomes(switched: TurnUsage, busts: SwitchOutcomes['busts'] = []): SwitchOutcomes {
  return {
    efforts: { seed: 'high', control: 'high', switched: 'medium' },
    seed: turn(0, 24_000),
    control: turn(24_000, 500),
    switched,
    busts,
  };
}

function usageLine(modelId: string, at: string, cacheRead = 0): UsageLine {
  return {
    kind: 'usage',
    at,
    sessionId: 's',
    modelId,
    version: '0.242.0',
    subagent: false,
    attempt: 1,
    reason: 'stop',
    inputTokens: 3,
    cacheReadInputTokens: cacheRead,
    totalInputTokens: cacheRead + 3,
    reasoningTokens: 0,
    outputTokens: 5,
    cachedTokensWritten: 7,
  };
}

function bustLine(at: string): BustLine {
  return {
    kind: 'bust',
    at,
    sessionId: 's',
    modelId: MODEL,
    previousModelId: MODEL,
    providerPath: 'anthropic',
    reason: 'not-append-only',
    firstMismatchIndex: 4,
    previousSegmentLabel: 'a',
    currentSegmentLabel: 'b',
    mismatchRegion: 'system',
    mismatchKind: 'content-changed',
  };
}

describe('switchVerdict rules on the switched turn against the control prefix', () => {
  test('a read at or above 90% of the prefix kept the cache', () => {
    expect(switchVerdict(outcomes(turn(24_384, 100)))).toBe(
      'switching effort from "high" to "medium" kept the cache: read 24,384 of 24,500 cached tokens',
    );
  });

  test('a read under 10% of the prefix re-wrote the cache', () => {
    expect(switchVerdict(outcomes(turn(100, 24_400)))).toBe(
      'switching effort from "high" to "medium" re-wrote the cache: read 100, wrote 24,400',
    );
  });

  test('a read between the two lines partly kept it and says both numbers', () => {
    expect(switchVerdict(outcomes(turn(12_000, 12_500)))).toBe(
      'switching effort from "high" to "medium" partly kept the cache: read 12,000 of 24,500 cached tokens, wrote 12,500',
    );
  });

  test('a control that missed the cache means the run cannot judge the switch', () => {
    const missed: SwitchOutcomes = { ...outcomes(turn(24_000, 0)), control: turn(1000, 23_000) };
    expect(switchVerdict(missed)).toBe(
      'the control turn at "high" read only 1,000 of the 24,000 tokens the seed turn wrote, so the cache never warmed and the run cannot judge the switch',
    );
  });

  test('a control that read less than the whole seed prompt still warmed if it read what the seed wrote', () => {
    const live: SwitchOutcomes = {
      ...outcomes(turn(25_003, 24)),
      seed: turn(13_523, 11_457),
      control: turn(22_260, 2743),
    };
    expect(switchVerdict(live)).toBe(
      'switching effort from "high" to "medium" kept the cache: read 25,003 of 25,003 cached tokens',
    );
  });

  test('a seed that wrote nothing cannot judge the switch either', () => {
    const empty: SwitchOutcomes = { ...outcomes(turn(0, 0)), seed: turn(24_000, 0) };
    expect(switchVerdict(empty)).toBe(
      'the seed turn wrote nothing to the cache, so the run cannot judge the switch',
    );
  });
});

describe('switchVerdict trusts the effort the transcript recorded, not the label', () => {
  const unchanged =
    'the effort did not change as intended: the seed turn ran at "high", the control turn at "high", the switched turn at "high", so the run cannot judge the switch';

  test('a switched turn that still ran at the control effort makes no cache claim', () => {
    const stuck: SwitchOutcomes = {
      ...outcomes(turn(24_500, 0)),
      efforts: { seed: 'high', control: 'high', switched: 'high' },
    };
    expect(switchVerdict(stuck)).toBe(unchanged);
  });

  test('a seed and control at different efforts make no cache claim', () => {
    const drifted: SwitchOutcomes = {
      ...outcomes(turn(24_500, 0)),
      efforts: { seed: 'medium', control: 'high', switched: 'low' },
    };
    expect(switchVerdict(drifted)).toBe(
      'the effort did not change as intended: the seed turn ran at "medium", the control turn at "high", the switched turn at "low", so the run cannot judge the switch',
    );
  });

  test('the efforts in the ruling are the transcript values', () => {
    const low: SwitchOutcomes = {
      ...outcomes(turn(24_500, 0)),
      efforts: { seed: 'xhigh', control: 'xhigh', switched: 'low' },
    };
    expect(switchVerdict(low)).toBe(
      'switching effort from "xhigh" to "low" kept the cache: read 24,500 of 24,500 cached tokens',
    );
  });

  test('a warning still shows when the effort did not change', () => {
    const stuck: SwitchOutcomes = {
      ...outcomes(turn(24_500, 0), [
        { turn: 'switched', region: 'tools', kind: 'removed', index: 2 },
      ]),
      efforts: { seed: 'high', control: 'high', switched: 'high' },
    };
    expect(switchVerdict(stuck).split('\n')).toHaveLength(2);
  });
});

describe('switchVerdict names a not-append-only warning after the ruling', () => {
  test('it says the turn, region, kind and index', () => {
    const text = switchVerdict(
      outcomes(turn(100, 24_400), [
        { turn: 'switched', region: 'system', kind: 'content-changed', index: 4 },
      ]),
    );
    expect(text.split('\n')).toEqual([
      'switching effort from "high" to "medium" re-wrote the cache: read 100, wrote 24,400',
      'Droid warned on the switched turn that the request was not append-only: mismatch in system, kind content-changed, first at index 4',
    ]);
  });

  test('a warning shows even when the run cannot judge the switch', () => {
    const missed: SwitchOutcomes = {
      ...outcomes(turn(0, 0), [{ turn: 'control', region: 'tools', kind: 'removed', index: 0 }]),
      control: turn(0, 24_000),
    };
    expect(switchVerdict(missed).split('\n')).toHaveLength(2);
    expect(switchVerdict(missed)).toContain('on the control turn');
  });
});

describe('turnLine picks the usage line that carries the turn', () => {
  test('it takes the last line logged by the session model', () => {
    const added = [usageLine(MODEL, 't1', 10), usageLine(MODEL, 't2', 20)];
    expect(turnLine(added, MODEL, 'seed').cacheReadInputTokens).toBe(20);
  });

  test('it skips lines from another model', () => {
    const added = [usageLine(MODEL, 't1', 10), usageLine('other-model', 't2', 99)];
    expect(turnLine(added, MODEL, 'seed').cacheReadInputTokens).toBe(10);
  });

  test('it throws and names the models logged when none matches', () => {
    expect(() => turnLine([usageLine('other-model', 't1')], MODEL, 'control')).toThrow(
      `the control turn logged no usage line for ${MODEL}; models logged: other-model`,
    );
  });

  test('turnUsage maps the log fields to read, write and input', () => {
    expect(turnUsage(usageLine(MODEL, 't1', 50))).toEqual({
      input: 3,
      cacheRead: 50,
      cacheWrite: 7,
    });
  });
});

describe('bustsByTurn files a warning under the first turn that ended after it', () => {
  const ends = {
    seed: '2026-10-15T10:00:10.000Z',
    control: '2026-10-15T10:00:20.000Z',
    switched: '2026-10-15T10:00:30.000Z',
  };

  test('a warning between two turn ends belongs to the later turn', () => {
    const found = bustsByTurn([bustLine('2026-10-15T10:00:25.000Z')], ends);
    expect(found).toEqual([
      { turn: 'switched', region: 'system', kind: 'content-changed', index: 4 },
    ]);
  });

  test('a warning before the seed ends belongs to the seed', () => {
    expect(bustsByTurn([bustLine('2026-10-15T10:00:05.000Z')], ends)[0]?.turn).toBe('seed');
  });

  test('a warning after the last turn is dropped', () => {
    expect(bustsByTurn([bustLine('2026-10-15T10:01:00.000Z')], ends)).toEqual([]);
  });
});
