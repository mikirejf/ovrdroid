import { afterEach, beforeEach, describe, expect, test } from 'bun:test';

import { usagePatches } from '../usage-patches.ts';
import { warmerPatches } from '../warmer-patches.ts';
import { patchNamed, payloadFunction } from './payload.ts';

interface TurnUsage {
  inputTokens: number;
  outputTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
  thinkingTokens: number;
  odWarm?: boolean;
}

interface UsageLine {
  s: string;
  m: string;
  cr: number;
}

interface Session {
  commitTurnTokenUsage: (usage: TurnUsage, model: string) => string;
}

interface CustomModel {
  thinkingMaxTokens: number;
  maxOutputTokens: number;
}

interface ThinkingConfig {
  enableThinking: boolean;
  thinkingMaxTokens: number;
  maxOutputTokens?: number;
}

type ThinkingConfigOf = (
  maxTokensOverride: number | undefined,
  customModel: CustomModel,
) => ThinkingConfig | undefined;

const MAX_TOKENS = patchNamed(warmerPatches, 'cache-warm-max-tokens').replace;
const EFFORT = patchNamed(warmerPatches, 'cache-warm-effort').replace;
const LOG = patchNamed(usagePatches, 'cache-usage-log').replace;

const COUNTED = {
  inputTokens: 3,
  outputTokens: 1,
  cacheCreationTokens: 0,
  cacheReadTokens: 12_562,
  thinkingTokens: 0,
};

const CUSTOM_MODEL: CustomModel = { thinkingMaxTokens: 8000, maxOutputTokens: 128_000 };

function buildThinkingConfig(): ThinkingConfigOf {
  const body =
    'let c;const Gte=(o)=>{c=o.customThinkingConfig};const ae=[],Hs={};' +
    `Gte({customThinkingConfig:fe&&!0?{enableThinking:!0,thinkingMaxTokens:fe.thinkingMaxTokens,${MAX_TOKENS}});return c`;
  return payloadFunction<[number | undefined, CustomModel], ThinkingConfig | undefined>(
    ['Mt', 'fe'],
    body,
  );
}

function buildSession(): Session {
  return payloadFunction<[], Session>(
    [],
    `return{currentSessionId:"parent",${LOG}return"committed"}}`,
  )();
}

let logged: UsageLine[] = [];

beforeEach(() => {
  logged = [];
  Object.assign(globalThis, {
    __odUsage: (line: UsageLine): void => {
      logged.push(line);
    },
  });
});

afterEach(() => {
  Reflect.deleteProperty(globalThis, '__odUsage');
});

describe('cache-usage-log', () => {
  const session = buildSession();

  test('logs a normal request', () => {
    expect(session.commitTurnTokenUsage({ ...COUNTED, odWarm: false }, 'claude')).toBe('committed');
    expect(logged).toHaveLength(1);
    expect(logged[0]).toMatchObject({ s: 'parent', m: 'claude', cr: 12_562 });
  });

  test('skips the line for a warm but still commits it', () => {
    expect(session.commitTurnTokenUsage({ ...COUNTED, odWarm: true }, 'claude')).toBe('committed');
    expect(logged).toHaveLength(0);
  });
});

describe('cache-warm-max-tokens', () => {
  test('an explicit output cap is not overwritten by the model maximum', () => {
    expect(buildThinkingConfig()(1, CUSTOM_MODEL)?.maxOutputTokens).toBeUndefined();
  });

  test('without a cap the model maximum still applies', () => {
    expect(buildThinkingConfig()(undefined, CUSTOM_MODEL)?.maxOutputTokens).toBe(128_000);
  });
});

describe('cache-warm-effort', () => {
  test('the snapshot carries the effort the turn is sent with', () => {
    expect(EFFORT).toContain('pY({effort:Yt,');
  });
});
