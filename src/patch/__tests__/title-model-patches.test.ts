import { describe, expect, test } from 'bun:test';
import { existsSync, readFileSync } from 'node:fs';

import { patchSource } from '../../binary/apply.ts';
import type { App } from '../../binary/graph.ts';
import { joinApp, readApp } from '../../binary/graph.ts';
import { backupPath, INSTALLED_DROID } from '../../paths.ts';
import { findMarker } from '../patches.ts';
import { applies, rebaseAll } from '../rebase.ts';
import { titleModelPatches } from '../title-model-patches.ts';
import { freeNames } from '../tokens.ts';
import { patchNamed, payloadFunction } from './payload.ts';

const PATCH = patchNamed(titleModelPatches, 'session-title-model-setting');

test('every name of three characters or fewer in the payload is captured by the anchors or owned', () => {
  const anchors = [PATCH.find, ...(PATCH.lookups ?? [])].join(' ');
  const captured = new Set(freeNames(anchors));
  const stray = freeNames(PATCH.replace).filter(
    (name) => !name.startsWith('$OD') && !captured.has(name),
  );
  expect(stray).toEqual([]);
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

function stockApp(): App | undefined {
  const binary = [INSTALLED_DROID, backupPath(INSTALLED_DROID)].find((target) => {
    if (!existsSync(target)) {
      return false;
    }
    return findMarker(readApp(readFileSync(target))[0].text) === undefined;
  });
  return binary === undefined ? undefined : readApp(readFileSync(binary));
}

const stock = stockApp();

function occurrences(text: string, part: string): number {
  return text.split(part).length - 1;
}

describe.skipIf(stock === undefined)('the shipped title generator', () => {
  const app = stock;

  test('has the one call that picks the title model, and the patch replaces it', () => {
    if (app === undefined) {
      throw new Error('no stock Droid to read');
    }
    const stockText = joinApp(app);
    const patchedText = joinApp(patchSource(app, [PATCH]));
    const [rebase] = rebaseAll(
      [PATCH],
      app.map((module) => module.text),
    );
    expect(rebase !== undefined && applies(rebase)).toBe(true);
    expect(occurrences(stockText, PATCH.find)).toBe(1);
    expect(occurrences(patchedText, PATCH.find)).toBe(0);
    expect(occurrences(patchedText, 'messageCallType:"session-title-generation"')).toBe(1);
  });
});
