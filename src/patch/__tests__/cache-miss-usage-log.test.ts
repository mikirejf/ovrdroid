import { afterEach, beforeEach, expect, mock, test } from 'bun:test';

import { applies, rebasePatch } from '../rebase.ts';
import { usagePatches } from '../usage-patches.ts';
import { describeStrayNames, patchNamed, payloadFunction } from './payload.ts';
import { requireStock } from './stock-scanner.ts';

const patch = patchNamed(usagePatches, 'cache-miss-usage-log');
const AT = 1_700_000_000_000;
const MISS = {
  reason: 'prefix_mismatch',
  firstMismatchIndex: 1,
  previousSegmentLabel: 'anthropic.system.0',
  currentSegmentLabel: 'anthropic.system.0',
  mismatchRegion: 'system',
  mismatchKind: 'segment_changed',
};

interface WarningFields {
  sessionId: string;
  assistantMessageId: string;
  modelId: string;
  apiProvider: string;
  name: string;
  type: string;
  value: typeof MISS;
}

type Warn = (message: string, fields: WarningFields) => void;

interface MissRow {
  t: number;
  s: string;
  m: string;
  miss: typeof MISS;
}

const recordRequest = payloadFunction<
  [
    miss: typeof MISS | undefined,
    warn: Warn,
    session: string,
    assistantMessage: string,
    model: string,
    provider: string,
  ],
  unknown
>(['x', 'r', 's', 'o', 'c', 'y'], `const Date={now:()=>${AT}};${patch.replace}`);

const log = mock<(row: MissRow) => void>();

beforeEach(() => {
  log.mockClear();
  Object.assign(globalThis, { __odUsage: log });
});

afterEach(() => {
  Reflect.deleteProperty(globalThis, '__odUsage');
});

test('the miss warning anchors on the stock binary', () => {
  expect(
    applies(
      rebasePatch(
        patch,
        requireStock().map((module) => module.text),
      ),
    ),
  ).toBe(true);
});

test('keeps the warning and writes one row with the original miss details', () => {
  const warn = mock<Warn>();
  recordRequest(MISS, warn, 'session', 'assistant', 'claude', 'anthropic');
  expect(warn.mock.calls).toEqual([
    [
      '[Prompt-Caching] Outgoing request is not append-only; prompt cache may be broken',
      {
        sessionId: 'session',
        assistantMessageId: 'assistant',
        modelId: 'claude',
        apiProvider: 'anthropic',
        name: 'prompt_cache_miss_detected',
        type: 'llm_prompt_cache',
        value: MISS,
      },
    ],
  ]);
  expect(log.mock.calls).toEqual([[{ t: AT, s: 'session', m: 'claude', miss: MISS }]]);
  expect(log.mock.calls[0]?.[0].miss).toBe(MISS);
});

test('does not warn or write a row when the monitor reports no miss', () => {
  const warn = mock<Warn>();
  recordRequest(undefined, warn, 'session', 'assistant', 'claude', 'anthropic');
  expect(warn).not.toHaveBeenCalled();
  expect(log).not.toHaveBeenCalled();
});

describeStrayNames(usagePatches);
