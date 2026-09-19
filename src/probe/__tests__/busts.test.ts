import { describe, expect, test } from 'bun:test';

import type { JoinedBust, QuotaRate } from '../busts.ts';
import { joinBusts, summariseBusts } from '../busts.ts';
import type { BustLine, LogRecords, UsageLine } from '../logs.ts';

const OPUS = 'claude-opus-5';
const FABLE = 'custom:droidproxy:fable-5-1';
const TOOLS_LABEL = 'anthropic.tools.11';
const GPT_LABEL = 'openai_responses.tools.4';

const OPUS_WRITE_TOKENS_PER_PERCENT = 776_667;
const OPUS_RATE: QuotaRate = {
  tokensPerPercent: OPUS_WRITE_TOKENS_PER_PERCENT,
  provenance: 'measured 2026-09-19 on claude-opus-5 over 700 sends',
};

const BEFORE = '2026-09-17T10:00:00.000Z';
const CLOSER_BEFORE = '2026-09-17T10:00:09.000Z';
const AT = '2026-09-17T10:00:10.000Z';
const CLOSER_AFTER = '2026-09-17T10:00:20.000Z';
const LATER_AFTER = '2026-09-17T10:00:30.000Z';

interface Warm {
  read: number;
  written: number;
  sessionId?: string;
  modelId?: string;
}

function usageOf(at: string, warm: Warm): UsageLine {
  return {
    kind: 'usage',
    at,
    sessionId: warm.sessionId ?? 's1',
    modelId: warm.modelId ?? OPUS,
    version: '0.222.0',
    subagent: false,
    attempt: 1,
    reason: 'tool-calls',
    inputTokens: 4,
    cacheReadInputTokens: warm.read,
    totalInputTokens: warm.read + 4,
    reasoningTokens: 0,
    outputTokens: 10,
    cachedTokensWritten: warm.written,
  };
}

function bustOf(at: string, extra: Partial<BustLine> = {}): BustLine {
  return {
    kind: 'bust',
    at,
    sessionId: 's1',
    modelId: OPUS,
    previousModelId: OPUS,
    providerPath: 'anthropic',
    reason: 'prefix_mismatch',
    firstMismatchIndex: 18,
    previousSegmentLabel: 'anthropic.messages.0.user.metadata',
    currentSegmentLabel: TOOLS_LABEL,
    mismatchRegion: 'messages',
    mismatchKind: 'segment_changed',
    ...extra,
  };
}

function records(usage: readonly UsageLine[], busts: readonly BustLine[]): LogRecords {
  return { usage: [...usage], busts: [...busts] };
}

function onlyJoined(usage: readonly UsageLine[], bust: BustLine): JoinedBust {
  const { joined } = joinBusts(records(usage, [bust]));
  const first = joined.at(0);
  if (first === undefined) {
    throw new Error('expected the bust to join');
  }
  return first;
}

function reportOf(usage: readonly UsageLine[], busts: readonly BustLine[]): string {
  const { joined, unjoinable } = joinBusts(records(usage, busts));
  return summariseBusts(joined, unjoinable, OPUS_RATE);
}

function rewritten(bust: JoinedBust): number {
  return Math.max(0, bust.warmBefore - bust.readAfter);
}

describe('a bust joins to the usage lines that bracket it in its own session', () => {
  test('the nearest line on each side wins, and other sessions are ignored', () => {
    const joined = onlyJoined(
      [
        usageOf(BEFORE, { read: 1000, written: 0 }),
        usageOf(CLOSER_BEFORE, { read: 4000, written: 500 }),
        usageOf('2026-09-17T10:00:09.500Z', { read: 9999, written: 9999, sessionId: 'other' }),
        usageOf('2026-09-17T10:00:10.500Z', { read: 9999, written: 9999, sessionId: 'other' }),
        usageOf(CLOSER_AFTER, { read: 3000, written: 100 }),
        usageOf(LATER_AFTER, { read: 7000, written: 0 }),
      ],
      bustOf(AT),
    );

    expect(joined.warmBefore).toBe(4500);
    expect(joined.readAfter).toBe(3000);
    expect(joined.wroteAfter).toBe(100);
    expect(rewritten(joined)).toBe(1500);
  });

  test('usage lines supplied out of timestamp order still join correctly', () => {
    const joined = onlyJoined(
      [
        usageOf(CLOSER_AFTER, { read: 3000, written: 100 }),
        usageOf(BEFORE, { read: 1000, written: 0 }),
        usageOf(CLOSER_BEFORE, { read: 4000, written: 500 }),
      ],
      bustOf(AT),
    );

    expect(joined.warmBefore).toBe(4500);
    expect(joined.readAfter).toBe(3000);
  });

  test('a bust with no usage line before it is unjoinable and adds no numbers', () => {
    const join = joinBusts(
      records([usageOf(CLOSER_AFTER, { read: 3000, written: 100 })], [bustOf(AT)]),
    );
    expect(join.joined).toHaveLength(0);
    expect(join.unjoinable).toBe(1);
    expect(summariseBusts(join.joined, join.unjoinable, OPUS_RATE)).toContain('1 unjoinable');
  });

  test('a bust with no usage line after it is unjoinable too', () => {
    const join = joinBusts(records([usageOf(BEFORE, { read: 3000, written: 100 })], [bustOf(AT)]));
    expect(join.joined).toHaveLength(0);
    expect(join.unjoinable).toBe(1);
  });
});

describe('the verdict says what the pair of usage lines can prove', () => {
  const verdictFor = (warm: Warm, readAfter: number): string =>
    onlyJoined(
      [usageOf(BEFORE, warm), usageOf(CLOSER_AFTER, { read: readAfter, written: 0 })],
      bustOf(AT),
    ).verdict;

  test('nothing warm before the bust is unmeasured, not a zero loss', () => {
    expect(verdictFor({ read: 0, written: 0 }, 5000)).toBe('unmeasured');
  });

  test('reading more than was warm is grew, because the pair is not one prefix', () => {
    expect(verdictFor({ read: 1000, written: 0 }, 4000)).toBe('grew');
  });

  test('reading nothing back is everything', () => {
    expect(verdictFor({ read: 1000, written: 500 }, 0)).toBe('everything');
  });

  test('reading back exactly what was warm is harmless', () => {
    expect(verdictFor({ read: 1000, written: 500 }, 1500)).toBe('harmless');
  });

  test('reading back part of what was warm is partial', () => {
    expect(verdictFor({ read: 1000, written: 500 }, 900)).toBe('partial');
  });

  test('rewritten never goes negative when the next request grew', () => {
    const joined = onlyJoined(
      [
        usageOf(BEFORE, { read: 1000, written: 0 }),
        usageOf(CLOSER_AFTER, { read: 9000, written: 0 }),
      ],
      bustOf(AT),
    );
    expect(rewritten(joined)).toBe(0);
  });
});

describe('the event kind comes only from fields the log really carries', () => {
  const eventFor = (extra: Partial<BustLine>): string =>
    onlyJoined(
      [
        usageOf(BEFORE, { read: 1000, written: 0 }),
        usageOf(CLOSER_AFTER, { read: 500, written: 0 }),
      ],
      bustOf(AT, extra),
    ).event;

  test('a label ending in the tools array names the tool list', () => {
    expect(eventFor({ currentSegmentLabel: TOOLS_LABEL })).toBe('tools');
  });

  test('a changed previousModelId wins over a label that also names the tools array', () => {
    expect(eventFor({ previousModelId: FABLE, currentSegmentLabel: TOOLS_LABEL })).toBe('model');
  });

  test('a label naming output_config is an output-config change', () => {
    expect(eventFor({ currentSegmentLabel: 'openai_responses.output_config' })).toBe(
      'output-config',
    );
  });

  test('any other label is other', () => {
    expect(eventFor({ currentSegmentLabel: 'anthropic.messages.3.user.text' })).toBe('other');
  });
});

describe('the cause says whether the session had only just started', () => {
  const causeAt = (at: string): string =>
    onlyJoined(
      [
        usageOf(BEFORE, { read: 1000, written: 0 }),
        usageOf('2026-09-17T10:00:50.000Z', { read: 500, written: 0 }),
      ],
      bustOf(at),
    ).cause;

  test('a bust 5 seconds after the first request of the session is session-start', () => {
    expect(causeAt('2026-09-17T10:00:05.000Z')).toBe('session-start');
  });

  test('a bust 31 seconds after the first request is mid-session', () => {
    expect(causeAt('2026-09-17T10:00:31.000Z')).toBe('mid-session');
  });

  test('a bust exactly 30 seconds after the first request is mid-session', () => {
    expect(causeAt(LATER_AFTER)).toBe('mid-session');
  });

  test('the report names both causes and says in words what each one means', () => {
    const report = reportOf(
      [
        usageOf(BEFORE, { read: 1000, written: 500 }),
        usageOf(CLOSER_AFTER, { read: 400, written: 600 }),
      ],
      [bustOf(AT)],
    );
    expect(report).toContain('per cause');
    expect(report).toContain(
      'the first request left before the MCP servers had connected, so the tools array grew on the second request; general.blockOnMcpLoad=true in ~/.factory/settings.json makes Droid wait for them',
    );
    expect(report).toContain(
      'a tool was loaded or the tool list changed while the session was running; a ToolSearch load of FetchUrl or WebSearch is the usual reason',
    );
  });
});

describe('the report refuses to turn a missing kind into a free one', () => {
  const report = reportOf(
    [
      usageOf(BEFORE, { read: 1000, written: 500 }),
      usageOf(CLOSER_AFTER, { read: 400, written: 600 }),
    ],
    [bustOf(AT)],
  );

  test('the kind that did happen carries its count and cost', () => {
    expect(report).toContain('tools: 1 busts, 1,100 rewritten, median 1,100');
  });

  test('a kind with no bust says there is no evidence instead of printing a cost', () => {
    expect(report).toContain('output-config: no evidence in this window');
    expect(report).not.toContain('output-config: 0 busts');
  });

  test('the provider path and the model each get their own numbers', () => {
    expect(report).toContain('anthropic: 1 busts, 1,100 rewritten');
    expect(report).toContain(`${OPUS}: 1 busts, 1,100 rewritten`);
  });

  test('the worst list names the timestamp, the model and the loss', () => {
    expect(report).toContain(`${AT} ${OPUS} tools: warm 1,500 -> read 400, 1,100 rewritten`);
  });

  test('the closing lines name what the logs cannot see at all', () => {
    expect(report).toContain('compaction');
    expect(report).toContain('which subagent caused a send');
  });
});

describe('the quota line is priced on the opus rows only', () => {
  test('an opus bust turns its rewritten tokens into a share of the 5 hour window', () => {
    const report = reportOf(
      [
        usageOf(BEFORE, { read: OPUS_WRITE_TOKENS_PER_PERCENT, written: 0 }),
        usageOf(CLOSER_AFTER, { read: 0, written: 0 }),
      ],
      [bustOf(AT)],
    );
    expect(report).toContain('1 opus busts, which is 1.0% of one 5 hour window');
    expect(report).toContain('776,667 cache-write tokens per 1%');
    expect(report).toContain('measured 2026-09-19 on claude-opus-5');
  });

  test('a non-opus bust is counted as unpriced, not as a cheap one', () => {
    const report = reportOf(
      [
        usageOf(BEFORE, { read: OPUS_WRITE_TOKENS_PER_PERCENT, written: 0, modelId: FABLE }),
        usageOf(CLOSER_AFTER, { read: 0, written: 0, modelId: FABLE }),
      ],
      [
        bustOf(AT, {
          modelId: FABLE,
          previousModelId: FABLE,
          providerPath: 'openai_responses',
          currentSegmentLabel: GPT_LABEL,
        }),
      ],
    );
    expect(report).toContain('no opus bust in this window, so nothing here can be priced');
    expect(report).not.toContain('0.0%');
    expect(report).toContain('openai_responses: 1 busts');
  });
});

describe('an empty window still produces a report', () => {
  const report = summariseBusts([], 0, OPUS_RATE);

  test('the headline counts nothing instead of throwing', () => {
    expect(report).toContain('cache-miss warnings: 0, 0 joined');
  });

  test('every group section says it has nothing rather than a zero cost', () => {
    expect(report).toContain('tools: no evidence in this window');
    expect(report).toContain('per provider path: none');
    expect(report).toContain('per model: none');
    expect(report).toContain('no opus bust in this window');
  });
});
