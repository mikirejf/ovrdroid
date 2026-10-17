import { afterEach, beforeEach, describe, expect, test } from 'bun:test';

import { usagePatches } from '../usage-patches.ts';
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

const LOG = patchNamed(usagePatches, 'cache-usage-log').replace;

const COUNTED = {
  inputTokens: 3,
  outputTokens: 1,
  cacheCreationTokens: 0,
  cacheReadTokens: 12_562,
  thinkingTokens: 0,
};

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
