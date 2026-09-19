import { describe, expect, test } from 'bun:test';

import type { LogFile } from '../logs.ts';
import { collapseLabel, parseLog, parseLogLine, summariseLogs } from '../logs.ts';

const USAGE_LINE =
  '[2026-09-17T22:02:49.597Z] INFO: [Agent] Streaming result | Context: {"count":4,"inputTokens":4,"cacheReadInputTokens":15699,"totalInputTokens":15703,"reasoningTokens":0,"outputTokens":218,"reason":"tool-calls","hasReasoningContent":false,"type":"message_delta","streamTerminalToEndMs":39,"cachedTokensWritten":127572,"attempt":1,"tags":{"clientType":"cli","version":"0.221.0","sessionId":"16925e03-5cfe-41e2-996c-6e75e5c271c5","callingSessionIdPresent":"false","modelId":"custom:droidproxy:fable-5-1","isByok":"true"}}';

const SUBAGENT_LINE =
  '[2026-09-17T22:03:10.000Z] INFO: [Agent] Streaming result | Context: {"inputTokens":10,"cacheReadInputTokens":20,"totalInputTokens":30,"reasoningTokens":5,"outputTokens":40,"reason":"stop","cachedTokensWritten":0,"attempt":2,"tags":{"version":"0.221.0","sessionId":"other-session","callingSessionIdPresent":"true","modelId":"claude-opus-5"}}';

const BUST_LINE =
  '[2026-09-17T22:06:04.777Z] WARN: [Prompt-Caching] Outgoing request is not append-only; prompt cache may be broken | Context: {"sessionId":"c3e62523-cb71-49ae-91cb-7d891796314d","assistantMessageId":"093c1760-7e14-4b85-a3f1-aeb0ae0104d5","modelId":"claude-opus-5","name":"prompt_cache_miss_detected","type":"llm_prompt_cache","value":{"previousModelId":"claude-opus-5","providerPath":"anthropic","reason":"prefix_mismatch","previousSegmentCount":33,"currentSegmentCount":48,"firstMismatchIndex":18,"previousSegmentLabel":"anthropic.messages.0.user.metadata","currentSegmentLabel":"anthropic.tools.11","mismatchRegion":"messages","mismatchKind":"segment_changed","isStablePrefixMismatch":true},"tags":{"clientType":"cli"}}';

const SECOND_BUST_LINE =
  '[2026-09-17T23:00:00.000Z] WARN: [Prompt-Caching] Outgoing request is not append-only; prompt cache may be broken | Context: {"sessionId":"s2","modelId":"claude-opus-5","name":"prompt_cache_miss_detected","value":{"reason":"count_shrank","firstMismatchIndex":3,"previousSegmentLabel":"anthropic.messages.4.user.metadata","currentSegmentLabel":"anthropic.tools.3","mismatchRegion":"tools","mismatchKind":"segment_removed"}}';

const OTHER_INFO_LINE =
  '[2026-09-17T22:02:49.000Z] INFO: [Agent] Something else entirely | Context: {"inputTokens":9}';

const BROKEN_USAGE_LINE =
  '[2026-09-17T22:02:49.000Z] INFO: [Agent] Streaming result | Context: {"inputTokens":4,';

const FILES: readonly LogFile[] = [
  { name: 'droid-log-single.log', bytes: 2 * 1024 * 1024 },
  { name: 'droid-log-single.log.2026-09-16', bytes: 1024 * 1024 },
];

describe('a usage line carries the per-request token truth', () => {
  test('every token field and tag is read off the context', () => {
    expect(parseLogLine(USAGE_LINE)).toEqual({
      kind: 'usage',
      at: '2026-09-17T22:02:49.597Z',
      sessionId: '16925e03-5cfe-41e2-996c-6e75e5c271c5',
      modelId: 'custom:droidproxy:fable-5-1',
      version: '0.221.0',
      subagent: false,
      attempt: 1,
      reason: 'tool-calls',
      inputTokens: 4,
      cacheReadInputTokens: 15_699,
      totalInputTokens: 15_703,
      reasoningTokens: 0,
      outputTokens: 218,
      cachedTokensWritten: 127_572,
    });
  });

  test('callingSessionIdPresent "true" marks the request as a subagent one', () => {
    const line = parseLogLine(SUBAGENT_LINE);
    expect(line?.kind).toBe('usage');
    expect(line).toMatchObject({ subagent: true, attempt: 2, modelId: 'claude-opus-5' });
  });
});

describe('a bust line carries where the prefix stopped matching', () => {
  test('the reason, index and both segment labels are read off value', () => {
    expect(parseLogLine(BUST_LINE)).toEqual({
      kind: 'bust',
      at: '2026-09-17T22:06:04.777Z',
      sessionId: 'c3e62523-cb71-49ae-91cb-7d891796314d',
      modelId: 'claude-opus-5',
      previousModelId: 'claude-opus-5',
      providerPath: 'anthropic',
      reason: 'prefix_mismatch',
      firstMismatchIndex: 18,
      previousSegmentLabel: 'anthropic.messages.0.user.metadata',
      currentSegmentLabel: 'anthropic.tools.11',
      mismatchRegion: 'messages',
      mismatchKind: 'segment_changed',
    });
  });
});

describe('lines that are not ground truth are skipped, never thrown', () => {
  test('an INFO line that is not a streaming result is ignored', () => {
    expect(parseLogLine(OTHER_INFO_LINE)).toBeUndefined();
  });

  test('a matching line whose context is broken JSON is skipped', () => {
    expect(parseLogLine(BROKEN_USAGE_LINE)).toBeUndefined();
  });

  test('a blank line is ignored', () => {
    expect(parseLogLine('')).toBeUndefined();
  });
});

describe('parseLog sorts a whole file into the two shapes', () => {
  test('only the matching lines land, in their own arrays', () => {
    const records = parseLog(
      [OTHER_INFO_LINE, USAGE_LINE, BROKEN_USAGE_LINE, BUST_LINE, SUBAGENT_LINE, ''].join('\n'),
    );
    expect(records.usage).toHaveLength(2);
    expect(records.busts).toHaveLength(1);
  });
});

describe('labels collapse their digits so kinds can be counted', () => {
  test('a tool index becomes N', () => {
    expect(collapseLabel('anthropic.tools.11')).toBe('anthropic.tools.N');
  });

  test('a message index inside a longer label becomes N too', () => {
    expect(collapseLabel('anthropic.messages.0.user.metadata')).toBe(
      'anthropic.messages.N.user.metadata',
    );
  });

  test('a label with no digits is left alone', () => {
    expect(collapseLabel('openai_responses.system')).toBe('openai_responses.system');
  });
});

describe('the summary reports what the files hold', () => {
  const records = parseLog([USAGE_LINE, SUBAGENT_LINE, BUST_LINE, SECOND_BUST_LINE].join('\n'));
  const report = summariseLogs(records, FILES);

  test('the files line counts the files, the span and the bytes', () => {
    expect(report).toContain('files: 2');
    expect(report).toContain('2026-09-17T22:02:49.597Z to 2026-09-17T23:00:00.000Z');
    expect(report).toContain('3.0 MB');
  });

  test('requests, sessions and subagent requests are counted', () => {
    expect(report).toContain('requests: 2, 2 sessions, 1 from subagents');
  });

  test('each model gets its own token sums', () => {
    expect(report).toContain(
      'custom:droidproxy:fable-5-1: 1 requests, cache read 15,699, cache written 127,572, uncached input 4, output 218',
    );
    expect(report).toContain(
      'claude-opus-5: 1 requests, cache read 20, cache written 0, uncached input 10, output 40',
    );
  });

  test('cache writes fall into size buckets', () => {
    expect(report).toContain('none: 1');
    expect(report).toContain('over 128k: 0');
    expect(report).toContain('32k to 128k: 1');
  });

  test('busts are counted by reason and by collapsed label', () => {
    expect(report).toContain('busts: 2');
    expect(report).toContain('prefix_mismatch: 1');
    expect(report).toContain('count_shrank: 1');
    expect(report).toContain('anthropic.tools.N: 2');
    expect(report).toContain('anthropic.messages.N.user.metadata: 2');
  });

  test('the closing line names the earliest date seen', () => {
    expect(report.split('\n').at(-1)).toBe('ground truth reaches back to 2026-09-17');
  });

  test('empty records still produce a report instead of throwing', () => {
    const empty = summariseLogs({ usage: [], busts: [] }, []);
    expect(empty).toContain('files: 0, no timestamped lines');
    expect(empty).toContain('requests: 0, 0 sessions, 0 from subagents');
    expect(empty.split('\n').at(-1)).toBe('no ground truth in these files');
  });
});
