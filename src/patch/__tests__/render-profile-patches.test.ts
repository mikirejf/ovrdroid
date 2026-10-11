import { describe, expect, test } from 'bun:test';
import * as fs from 'node:fs';

import { patchSource } from '../../binary/apply.ts';
import type { App } from '../../binary/graph.ts';
import { patches } from '../patches.ts';
import { applies, rebaseAll } from '../rebase.ts';
import {
  ownNames,
  PROFILING_FILE,
  reconcilerPatch,
  RENDERS_COMMAND,
  renderProfilePatches,
} from '../render-profile-patches.ts';
import { freeNames } from '../tokens.ts';
import { payloadFunction } from './payload.ts';
import { stockDroid } from './stock-scanner.ts';

const SLOW_PATCH_MS = 60_000;
const VENDORED_SHA256 = '1dbc8a3133cb679267f56f4d17bcb0a2543b1e4824e4b266636b7308720d6817';

const STAND_IN_RECONCILER =
  '"use strict";module.exports=function(config){var React=require("react"),Scheduler=require("scheduler");return{React,Scheduler,config}};';

type Factory = (config: { tag: string }) => object;

function evaluateModule(source: string): Factory {
  return payloadFunction<[], Factory>(
    [],
    `const module={exports:{}};${source}return module.exports`,
  )();
}

describe('owning the library names', () => {
  const LIBRARY =
    'module.exports=function(config){b:for(var j=0;;j++){if(j>1)break b}var tag=config.tag,out={tag:tag,seen:[j]};a:{for(var i=0;i<5;i++){if(i===3)break a;out.seen.push(i)}}return out};';

  test('every short name becomes a payload name and the code does the same thing', () => {
    const owned = ownNames(LIBRARY);
    expect(freeNames(owned)).toEqual([]);
    const original = evaluateModule(LIBRARY);
    const renamed = evaluateModule(owned);
    expect(renamed({ tag: 'x' })).toEqual(original({ tag: 'x' }));
  });

  test('a short global would be renamed into a name nothing defines, so it fails the build', () => {
    expect(() => ownNames('module.exports=function(){return new URL("http://x").host};')).toThrow(
      'renaming changed what the code means',
    );
  });

  test('the vendored file is the npm release of react-reconciler 0.33.0, byte for byte', () => {
    const hasher = new Bun.CryptoHasher('sha256');
    hasher.update(fs.readFileSync(PROFILING_FILE));
    expect(hasher.digest('hex')).toBe(VENDORED_SHA256);
  });

  test('the vendored profiling reconciler owns all its names', () => {
    const owned = ownNames(fs.readFileSync(PROFILING_FILE, 'utf-8'));
    expect(owned).toContain('require("react")');
    expect(owned).toContain('require("scheduler")');
  });
});

describe('the reconciler patch', () => {
  test('reads the profiling reconciler only when the patch text is asked for', () => {
    let reads = 0;
    const patch = reconcilerPatch(() => {
      reads += 1;
      return STAND_IN_RECONCILER;
    });
    expect(reads).toBe(0);
    expect(patch.replace).toBe(patch.replace);
    expect(reads).toBe(1);
  });

  test('keeps the stock module whole after the branch, so a Droid with recording off runs stock code', () => {
    const patch = reconcilerPatch(() => STAND_IN_RECONCILER);
    const stockTail = patch.find.slice(patch.find.indexOf('yl.exports=function(e)'));
    expect(patch.replace).toEndWith(`(JH,yl);return}${stockTail}`);
  });
});

function shipped(): App {
  if (stockDroid === undefined) {
    throw new Error('no stock Droid to patch');
  }
  return stockDroid;
}

describe.skipIf(stockDroid === undefined)('the render patches fit the shipped bundle', () => {
  const standIn = reconcilerPatch(() => STAND_IN_RECONCILER);
  const list = renderProfilePatches.map((patch) => (patch.name === standIn.name ? standIn : patch));
  const modules = (stockDroid ?? []).map((module) => module.text);

  test.each(rebaseAll(list, modules).map((rebase) => [rebase.name, rebase] as const))(
    '%s finds exactly one place',
    (_name, rebase) => {
      expect(rebase.matches).toBe(1);
      expect(applies(rebase)).toBe(true);
    },
  );

  test(
    'they apply with the shipped patch set, hand the reconciler React and the scheduler, and add /renders',
    () => {
      const withStandIn = patches.map((patch) => (patch.name === standIn.name ? standIn : patch));
      const patched = patchSource(shipped(), withStandIn)
        .map((module) => module.text)
        .join('\n');
      expect(patched).toContain(
        '{__CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE:',
      );
      expect(patched).not.toContain('require("react")');
      expect(patched).not.toContain('require("scheduler")');
      expect(patched.split('globalThis.$ODr)')).toHaveLength(2);
      expect(patched).toContain(`${RENDERS_COMMAND}:"immediate",`);
      expect(patched.split(`{name:"${RENDERS_COMMAND}"`)).toHaveLength(3);
    },
    SLOW_PATCH_MS,
  );
});
