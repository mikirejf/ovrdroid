import { describe, expect, test } from 'bun:test';

import type { SessionUsage } from '../cachekey.ts';
import { cachekeyArgv, formatCachekey, parseUsage, verdict } from '../cachekey.ts';

const SAMPLE =
  '{"type":"result","subtype":"success","is_error":false,"duration_ms":1870,"num_turns":1,"result":"ok","session_id":"311d06aa-c7a7-47e3-a3bf-85479f0de523","usage":{"input_tokens":10866,"output_tokens":5,"cache_read_input_tokens":0,"cache_creation_input_tokens":0,"factory_credits":436,"ttft_ms":1545}}';

function usage(over: Partial<SessionUsage> = {}): SessionUsage {
  return { inputTokens: 700, cacheReadTokens: 10_200, ttftMs: 900, ...over };
}

describe('the exec result line gives the session usage', () => {
  test('a real exec result line yields its token counts and ttft', () => {
    expect(parseUsage(`${SAMPLE}\n`)).toEqual({
      inputTokens: 10_866,
      cacheReadTokens: 0,
      ttftMs: 1545,
    });
  });

  test('noise and earlier events before the result line are skipped, and the last result wins', () => {
    const stdout = [
      'warming up',
      '{"type":"message","usage":{"input_tokens":1}}',
      '{not json',
      '{"type":"result","usage":{"input_tokens":1,"cache_read_input_tokens":2,"ttft_ms":3}}',
      '{"type":"result","usage":{"input_tokens":700,"cache_read_input_tokens":10200,"ttft_ms":900}}',
      '',
    ].join('\n');
    expect(parseUsage(stdout)).toEqual(usage());
  });

  test('a result line without usage is rejected', () => {
    expect(() => parseUsage('{"type":"result","result":"ok"}')).toThrow('no usage object');
  });

  test('output with no result line is rejected', () => {
    expect(() => parseUsage('ok\n{"type":"message"}\n')).toThrow('"type":"result"');
  });
});

describe('the report says whether a new session reused the cache', () => {
  test('a session that read nothing is called cold', () => {
    const sessions = [usage({ inputTokens: 10_866, cacheReadTokens: 0 })];
    expect(verdict(sessions)).toBe(
      'a new session started cold: nothing reused from the earlier session',
    );
    expect(formatCachekey(sessions)).toContain('median 0%');
  });

  test('a session that read the prompt says how much it reused', () => {
    const sessions = [
      usage(),
      usage({ cacheReadTokens: 10_000 }),
      usage({ cacheReadTokens: 10_400 }),
    ];
    expect(verdict(sessions)).toBe(
      'a new session read 10.2k of 10.9k prompt tokens from the cache an earlier session wrote',
    );
    const summary = formatCachekey(sessions);
    expect(summary).toContain('median 10.2k  range 10.0k to 10.4k');
    expect(summary).toContain('median 94% of prompt tokens');
    expect(summary).toContain('median 900ms');
  });
});

test('both sessions run exec in JSON mode in one fixed directory', () => {
  expect(cachekeyArgv('custom:gpt', '/tmp/x')).toEqual([
    'exec',
    '-m',
    'custom:gpt',
    '-o',
    'json',
    '--cwd',
    '/tmp/x',
    'Reply with exactly: ok',
  ]);
});
