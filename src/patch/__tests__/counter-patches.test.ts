import { afterEach, describe, expect, test } from 'bun:test';
import * as fs from 'node:fs';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { patchSource } from '../../binary/apply.ts';
import type { App } from '../../binary/graph.ts';
import { parseCounters } from '../../probe/counters.ts';
import { COUNTER_VARIABLE, counterPatches } from '../counter-patches.ts';
import { patches } from '../patches.ts';
import { applies, rebaseAll } from '../rebase.ts';
import { patchNamed, payloadFunction, restoreEnv } from './payload.ts';
import { stockDroid } from './stock-scanner.ts';

const INCREMENTS = [
  ['counter-commit', 'globalThis.$ODc.commit++;'],
  ['counter-root', 'globalThis.$ODc.root++;'],
  ['counter-message-list', 'globalThis.$ODc.list++;'],
  ['counter-markdown', 'globalThis.$ODc&&globalThis.$ODc.md++;'],
  ['counter-frame-build', 'globalThis.$ODc.build++,globalThis.$ODc.frameMs+=Q-e;'],
] as const;

const SLOW_PATCH_MS = 60_000;

function shipped(): App {
  if (stockDroid === undefined) {
    throw new Error('no stock Droid to patch');
  }
  return stockDroid;
}

describe.skipIf(stockDroid === undefined)('the counter patches fit the shipped bundle', () => {
  const modules = (stockDroid ?? []).map((module) => module.text);
  const rebases = rebaseAll(counterPatches, modules);

  test.each(rebases.map((rebase) => [rebase.name, rebase] as const))(
    '%s finds exactly one place',
    (_name, rebase) => {
      expect(rebase.matches).toBe(1);
      expect(applies(rebase)).toBe(true);
    },
  );

  test('each counter lands once in the patched bundle', () => {
    const patched = patchSource(shipped(), counterPatches)
      .map((module) => module.text)
      .join('\n');
    for (const field of ['commit', 'root', 'list', 'build']) {
      expect(patched.split(`globalThis.$ODc.${field}++`)).toHaveLength(2);
    }
    expect(patched.split('globalThis.$ODc&&globalThis.$ODc.md++')).toHaveLength(2);
    expect(patched.split('globalThis.$ODc.frameMs+=')).toHaveLength(2);
  });
});

describe('the counting sites only add a statement', () => {
  test.each(INCREMENTS)('%s leaves the shipped code as it was', (name, increment) => {
    const patch = patchNamed(counterPatches, name);
    expect(patch.replace.replace(increment, '')).toBe(patch.find);
  });
});

interface FakeStdout {
  written: string[];
  write: (chunk: string) => boolean;
}

interface FakeLog {
  (text: string): boolean;
  willRender: () => boolean;
}

interface InkHost {
  log?: FakeLog;
}

function fakeStdout(): FakeStdout {
  const written: string[] = [];
  return {
    written,
    write(chunk) {
      written.push(chunk);
      return true;
    },
  };
}

function startInk(stdout: FakeStdout) {
  const created: FakeLog[] = [];
  const vC = {
    create(target: FakeStdout) {
      const log = Object.assign(
        (text: string) => {
          target.write(text);
          return text !== '';
        },
        { willRender: () => true },
      );
      created.push(log);
      return log;
    },
  };
  const start = payloadFunction<[typeof vC, object, () => typeof fs], FakeLog | undefined>(
    ['vC', 'e', 'require'],
    `${patchNamed(counterPatches, 'counter-ink-start').replace};return this.log`,
  );
  const host: InkHost = {};
  const log = start.call(host, vC, { stdout, incrementalRendering: false }, () => fs);
  return { log, original: created[0] };
}

function counters(): Record<string, number> {
  const value: unknown = Object.getOwnPropertyDescriptor(globalThis, '$ODc')?.value;
  if (typeof value !== 'object' || value === null) {
    throw new TypeError('the counter object was never created');
  }
  return Object.fromEntries(Object.entries(value));
}

const folders: string[] = [];
const savedPath = Bun.env[COUNTER_VARIABLE];

afterEach(() => {
  Reflect.deleteProperty(globalThis, '$ODc');
  restoreEnv(COUNTER_VARIABLE, savedPath);
  for (const folder of folders.splice(0)) {
    rmSync(folder, { recursive: true, force: true });
  }
});

test.skipIf(stockDroid === undefined)(
  'the counters count each message-list render on top of the shipped patch set',
  () => {
    const patched = patchSource(shipped(), [...patches, ...counterPatches])
      .map((module) => module.text)
      .join('\n');
    const opening = /\(\{groupedMessages:[^}]+\}\)=>\{globalThis\.\$ODc\.list\+\+;/u.exec(
      patched,
    )?.[0];
    if (opening === undefined) {
      throw new Error('the message-list render entry has no counter');
    }
    const render = payloadFunction<[object], null>(
      ['$ODprops'],
      `return (${opening}return null})($ODprops)`,
    );
    Reflect.deleteProperty(Bun.env, COUNTER_VARIABLE);
    startInk(fakeStdout());

    expect(render({ groupedMessages: [] })).toBeNull();
    expect(counters()['list']).toBe(1);
    expect(
      render({ groupedMessages: [], isAgentActive: true, isSessionPromptActive: true }),
    ).toBeNull();
    expect(counters()['list']).toBe(2);
  },
  SLOW_PATCH_MS,
);

describe('the counter start payload', () => {
  test('with the variable unset it hands back the shipped log and touches nothing', () => {
    Reflect.deleteProperty(Bun.env, COUNTER_VARIABLE);
    const stdout = fakeStdout();
    const { write } = stdout;
    const { log, original } = startInk(stdout);

    expect(log).toBe(original);
    expect(stdout.write).toBe(write);
    expect(counters()).toEqual({
      commit: 0,
      build: 0,
      frame: 0,
      frameMs: 0,
      root: 0,
      list: 0,
      md: 0,
      bytes: 0,
    });
  });

  test('with the variable set it counts written frames and their bytes, not skipped ones', () => {
    const folder = mkdtempSync(path.join(tmpdir(), 'od-counters-'));
    folders.push(folder);
    const file = path.join(folder, 'counters.jsonl');
    Bun.env[COUNTER_VARIABLE] = file;

    const stdout = fakeStdout();
    const { log, original } = startInk(stdout);

    expect(log).not.toBe(original);
    expect(log?.willRender()).toBe(true);
    expect(log?.('abc')).toBe(true);
    expect(log?.('')).toBe(false);
    expect(log?.('de')).toBe(true);

    expect(counters()['frame']).toBe(2);
    expect(counters()['bytes']).toBe(5);
    expect(stdout.written).toEqual(['abc', '', 'de']);
  });

  test('with the variable set it writes a first sample at once', () => {
    const folder = mkdtempSync(path.join(tmpdir(), 'od-counters-'));
    folders.push(folder);
    const file = path.join(folder, 'counters.jsonl');
    Bun.env[COUNTER_VARIABLE] = file;

    startInk(fakeStdout());

    const [first] = parseCounters(readFileSync(file, 'utf-8'));
    expect(first?.pid).toBe(process.pid);
    expect(first?.commit).toBe(0);
    expect(first?.cpuUser).toBeGreaterThan(0);
  });

  test('a second Ink keeps the counters the first one made', () => {
    Reflect.deleteProperty(Bun.env, COUNTER_VARIABLE);
    startInk(fakeStdout());
    const first: unknown = Object.getOwnPropertyDescriptor(globalThis, '$ODc')?.value;
    startInk(fakeStdout());
    expect(Object.getOwnPropertyDescriptor(globalThis, '$ODc')?.value).toBe(first);
  });
});
