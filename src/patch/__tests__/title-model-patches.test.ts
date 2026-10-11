import { describe, expect, test } from 'bun:test';

import { applies } from '../rebase.ts';
import { titleModelPatches } from '../title-model-patches.ts';
import { occurrences, patchNamed, payloadFunction, strayNames } from './payload.ts';
import { shipped, stockDroid, stockText } from './stock-scanner.ts';

const PATCH = patchNamed(titleModelPatches, 'session-title-model-setting');

test('every name of three characters or fewer in the payload is captured by the anchors or owned', () => {
  expect(strayNames(PATCH)).toEqual([]);
});

interface World {
  setting?: string | undefined;
  customIds: string[];
  blockedIds?: string[];
  builtInAllowed: string[];
  sessionModel?: string | undefined;
}

const SESSION_MODEL = 'custom:proxy:opus';
const STOCK_FALLBACK = 'claude-haiku-4-5-20251001';

function titleModelIn(world: World): string {
  const settings = {
    settings: { general: { sessionTitleModel: world.setting } },
    getCustomModels: () => world.customIds.map((id) => ({ id })),
    validateModelAccess: (id: string) => ({ allowed: !(world.blockedIds ?? []).includes(id) }),
  };
  const builtInAllowed = (id: string) => world.builtInAllowed.includes(id);
  const stockTee = (options: { fallback: () => string }) => ({
    modelId: world.sessionModel ?? options.fallback(),
  });
  return payloadFunction<
    [typeof builtInAllowed, () => typeof settings, typeof stockTee, string[]],
    string
  >(
    ['qi', 'f', 'Tee', 'qU'],
    `${PATCH.replace}if(v)return v;return"${STOCK_FALLBACK}"}});return u`,
  )(builtInAllowed, () => settings, stockTee, [STOCK_FALLBACK]);
}

const CUSTOM_LUNA = 'custom:proxy:luna';
const CUSTOM_SOL = 'custom:proxy:sol';
const OPEN: World = {
  customIds: [CUSTOM_LUNA, CUSTOM_SOL],
  builtInAllowed: ['gpt-6-luna', 'gpt-6-sol', STOCK_FALLBACK],
  sessionModel: SESSION_MODEL,
};

describe('the title model setting', () => {
  test('names a custom model that policy allows', () => {
    expect(titleModelIn({ ...OPEN, setting: CUSTOM_SOL })).toBe(CUSTOM_SOL);
  });

  test('names a built-in model that policy allows', () => {
    expect(titleModelIn({ ...OPEN, setting: 'gpt-6-sol' })).toBe('gpt-6-sol');
  });

  test('defaults to the built-in gpt-6-luna when unset', () => {
    expect(titleModelIn({ ...OPEN, setting: undefined })).toBe('gpt-6-luna');
  });

  test('falls back to stock when the custom model is blocked', () => {
    expect(titleModelIn({ ...OPEN, setting: CUSTOM_SOL, blockedIds: [CUSTOM_SOL] })).toBe(
      SESSION_MODEL,
    );
  });

  test('falls back to stock when the built-in model is blocked', () => {
    expect(titleModelIn({ ...OPEN, setting: 'gpt-6-sol', builtInAllowed: [STOCK_FALLBACK] })).toBe(
      SESSION_MODEL,
    );
  });

  test('falls back to stock when the unset default is blocked', () => {
    expect(titleModelIn({ ...OPEN, builtInAllowed: [STOCK_FALLBACK] })).toBe(SESSION_MODEL);
  });

  test('falls back to stock when it names no model Droid knows', () => {
    expect(titleModelIn({ ...OPEN, setting: 'custom:proxy:gone' })).toBe(SESSION_MODEL);
  });

  test('reaches the stock preferred model when the session runs a built-in model', () => {
    expect(titleModelIn({ ...OPEN, setting: 'nothing', sessionModel: undefined })).toBe(
      STOCK_FALLBACK,
    );
  });
});

const { patchedText, rebasedNamed } = shipped([PATCH]);

describe.skipIf(stockDroid === undefined)('the shipped title generator', () => {
  test('has the one call that picks the title model, and the patch replaces it', () => {
    const rebase = rebasedNamed(PATCH.name);
    if (!applies(rebase)) {
      throw new Error('the title model patch does not apply to the stock Droid');
    }
    expect(occurrences(stockText, rebase.find)).toBe(1);
    expect(occurrences(patchedText, rebase.find)).toBe(0);
    expect(occurrences(patchedText, 'messageCallType:"session-title-generation"')).toBe(1);
  });
});
