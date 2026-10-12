import { afterEach, beforeEach, describe, expect, mock, spyOn, test } from 'bun:test';
import * as fs from 'node:fs';
import * as os from 'node:os';
import path from 'node:path';

import type { DayFile } from '../../probe/renders-log.ts';
import { parseDayFile } from '../../probe/renders-log.ts';
import { parseRenders } from '../../probe/renders-parse.ts';
import { CONFIG_FILE } from '../ovrdroid-config.ts';
import {
  MESSAGES_HOOK,
  RENDER_GATE,
  RENDER_HOOK,
  RENDERS_DIR,
  RENDERS_TOGGLE,
  RENDERS_USAGE,
  RENDERS_VARIABLE,
} from '../render-profile-patches.ts';
import { payloadFunction, restoreEnv } from './payload.ts';
import type { Fiber } from './render-fibers.ts';
import { fiber, FUNCTION, PERFORMED_WORK, root } from './render-fibers.ts';

const HOME_VARIABLE = 'FACTORY_HOME_OVERRIDE';
const saved = { probe: Bun.env[RENDERS_VARIABLE], home: Bun.env[HOME_VARIABLE] };
let home = '';

interface Hook {
  inject: () => number;
  onCommitFiberRoot: (id: number, fiberRoot: { current: Fiber }) => void;
  flush: () => void;
  cause: (store: FakeStore, type: string) => void;
  snapshot: (messages: readonly Message[], store: FakeStore) => void;
  typed: () => void;
  working: (manager: SessionManager, state: string) => void;
}

interface FakeStore {
  version: number;
  getVersion: () => number;
  getStreamingVersion: () => number;
}

interface SessionManager {
  session: string;
}

interface Message {
  id: string;
  content: readonly string[];
}

interface MessageHook {
  memoizedState: readonly Message[];
  queue: { value: null; getSnapshot: () => readonly Message[] };
  next: null;
}

function fakeStore(): FakeStore {
  const store: FakeStore = {
    version: 0,
    getVersion: () => store.version,
    getStreamingVersion: () => 0,
  };
  return store;
}

function messageRoot(
  type: () => number,
  previous: readonly Message[],
  next: readonly Message[],
): Fiber {
  const read = { value: null, getSnapshot: () => next };
  const list = (value: readonly Message[]): MessageHook => ({
    memoizedState: value,
    queue: read,
    next: null,
  });
  return fiber(FUNCTION, type, {
    flags: PERFORMED_WORK,
    actualDuration: 2,
    alternate: fiber(FUNCTION, type, { memoizedState: list(previous) }),
    memoizedState: list(next),
  });
}

function settingsChange(hook: Hook | undefined, type: () => number): Fiber {
  const store = fakeStore();
  const before: Message[] = [{ id: 'a', content: [] }];
  const after: Message[] = [{ id: 'a', content: [] }];
  hook?.snapshot(before, store);
  store.version += 1;
  hook?.cause(store, 'settings_updated');
  hook?.snapshot(after, store);
  return messageRoot(type, before, after);
}

function ignore(): void {}

type Module = typeof fs | typeof os;
type Require = (name: string) => Module;

interface Config {
  renders?: boolean;
  width?: string;
}

function stubRequire(name: string): Module {
  return name === 'os' ? os : fs;
}

function installedHook(): Hook | undefined {
  const value: unknown = Object.getOwnPropertyDescriptor(
    globalThis,
    '__REACT_DEVTOOLS_GLOBAL_HOOK__',
  )?.value;
  // SAFETY: the hook payload is the only writer of this global in these tests.
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion
  return value as Hook | undefined;
}

function startReconciler(): Hook | undefined {
  payloadFunction<[Require], undefined>(
    ['require'],
    `${RENDER_GATE}if($ODon){${RENDER_HOOK}}`,
  )(stubRequire);
  const hook = installedHook();
  if (hook !== undefined) {
    process.removeListener('exit', hook.flush);
  }
  return hook;
}

function component(body: string): () => number {
  return payloadFunction<[], () => number>([], `return function Row(){return ${body}}`)();
}

function commit(hook: Hook | undefined, fibers: readonly Fiber[]): void {
  hook?.onCommitFiberRoot(1, { current: root(fibers) });
}

function factory(): string {
  return path.join(home, '.factory');
}

function writeConfig(config: Config): void {
  fs.mkdirSync(factory(), { recursive: true });
  fs.writeFileSync(path.join(factory(), CONFIG_FILE), JSON.stringify(config));
}

function readConfig(): Config {
  const text = fs.readFileSync(path.join(factory(), CONFIG_FILE), 'utf-8');
  // SAFETY: the toggle payload wrote this file in the test that reads it.
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion
  return JSON.parse(text) as Config;
}

function dayFile(day: string): DayFile {
  const text = fs.readFileSync(
    path.join(factory(), RENDERS_DIR, day, `${process.pid}.json`),
    'utf-8',
  );
  const parsed = parseDayFile(text);
  if (parsed === undefined) {
    throw new TypeError(`the daily file for ${day} is not a day file`);
  }
  return parsed;
}

beforeEach(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), 'od-renders-'));
  Bun.env[HOME_VARIABLE] = home;
  Reflect.deleteProperty(Bun.env, RENDERS_VARIABLE);
});

afterEach(() => {
  mock.restore();
  Reflect.deleteProperty(globalThis, '__REACT_DEVTOOLS_GLOBAL_HOOK__');
  Reflect.deleteProperty(globalThis, '$ODr');
  restoreEnv(RENDERS_VARIABLE, saved.probe);
  restoreEnv(HOME_VARIABLE, saved.home);
  fs.rmSync(home, { recursive: true, force: true });
});

describe('the gate at the start of the reconciler module', () => {
  test('with no setting and no variable it installs nothing, so React finds no DevTools', () => {
    expect(startReconciler()).toBeUndefined();
    expect(Reflect.has(globalThis, '$ODr')).toBe(false);
  });

  test('a setting of false installs nothing', () => {
    writeConfig({ renders: false });
    expect(startReconciler()).toBeUndefined();
  });

  test('a broken settings file installs nothing', () => {
    fs.mkdirSync(factory(), { recursive: true });
    fs.writeFileSync(path.join(factory(), CONFIG_FILE), '{');
    expect(startReconciler()).toBeUndefined();
  });

  test('a setting of true installs the hook', () => {
    writeConfig({ renders: true });
    expect(startReconciler()?.inject()).toBe(1);
    expect(Object.getOwnPropertyDescriptor(globalThis, '$ODr')?.value).toBe(installedHook());
  });

  test('a hook that is already there is left alone', () => {
    writeConfig({ renders: true });
    const existing: Hook = {
      inject: () => 0,
      onCommitFiberRoot: ignore,
      flush: ignore,
      cause: ignore,
      snapshot: ignore,
      typed: ignore,
      working: ignore,
    };
    Object.defineProperty(globalThis, '__REACT_DEVTOOLS_GLOBAL_HOOK__', {
      value: existing,
      configurable: true,
    });
    startReconciler();
    expect(installedHook()).toBe(existing);
    expect(Reflect.has(globalThis, '$ODr')).toBe(false);
  });
});

describe('the probe sink', () => {
  test('writes one line per commit that probe renders reads back, and no daily file', () => {
    const file = path.join(home, 'renders.jsonl');
    Bun.env[RENDERS_VARIABLE] = file;
    const hook = startReconciler();
    commit(hook, [fiber(FUNCTION, component('1'), { actualDuration: 4 })]);

    const [line] = parseRenders(fs.readFileSync(file, 'utf-8'));
    expect(line?.pid).toBe(process.pid);
    expect(line?.renders).toEqual([[1, 4, 'mount']]);
    expect(line?.types?.map(([id, name]) => [id, name])).toEqual([[1, 'Row']]);
    hook?.flush();
    expect(fs.existsSync(path.join(factory(), RENDERS_DIR))).toBe(false);
  });

  test('each line says what Droid was doing, and describes a changed hook once', () => {
    const file = path.join(home, 'renders.jsonl');
    Bun.env[RENDERS_VARIABLE] = file;
    const hook = startReconciler();
    const type = component('0');
    hook?.working({ session: 'main' }, 'executing_tool');
    commit(hook, [settingsChange(hook, type)]);
    commit(hook, [settingsChange(hook, type)]);

    const [first, second] = parseRenders(fs.readFileSync(file, 'utf-8'));
    expect(first?.activity).toBe('tool');
    expect(first?.renders).toEqual([[1, 2, 'state', [], [0], ['settings_updated', 1]]]);
    expect(first?.hookTypes?.map(([id, index, kind]) => [id, index, kind])).toEqual([
      [1, 0, MESSAGES_HOOK],
    ]);
    expect(second?.hookTypes).toBeUndefined();
  });
});

describe('the daily sink', () => {
  const NOON = new Date(2026, 9, 11, 12).getTime();
  const LATE = new Date(2026, 9, 11, 23, 59).getTime();
  const NEXT_DAY = new Date(2026, 9, 12, 0, 1).getTime();

  test('sums renders by component source, so same-named components stay apart', () => {
    spyOn(Date, 'now').mockReturnValue(NOON);
    writeConfig({ renders: true });
    const hook = startReconciler();
    const first = component('1');
    const second = component('2');
    commit(hook, [
      fiber(FUNCTION, first, { actualDuration: 2 }),
      fiber(FUNCTION, second, { actualDuration: 1 }),
    ]);
    commit(hook, [fiber(FUNCTION, first, { actualDuration: 3 })]);
    hook?.flush();

    const written = dayFile('2026-10-11');
    expect(written.pid).toBe(process.pid);
    expect(written.commits).toBe(2);
    expect(written.components.map(({ name, renders, selfMs }) => [name, renders, selfMs])).toEqual([
      ['Row', 2, 5],
      ['Row', 1, 1],
    ]);
    expect(written.components[0]?.reasons).toEqual({ mount: 2 });
  });

  test('writes nothing when nothing was committed or nothing changed since the last write', () => {
    spyOn(Date, 'now').mockReturnValue(NOON);
    writeConfig({ renders: true });
    const hook = startReconciler();
    hook?.flush();
    expect(fs.existsSync(path.join(factory(), RENDERS_DIR))).toBe(false);

    commit(hook, [fiber(FUNCTION, component('1'))]);
    hook?.flush();
    const file = path.join(factory(), RENDERS_DIR, '2026-10-11', `${process.pid}.json`);
    fs.rmSync(file);
    hook?.flush();
    expect(fs.existsSync(file)).toBe(false);
  });

  test('a commit after local midnight closes the old day and starts a new file', () => {
    const now = spyOn(Date, 'now').mockReturnValue(LATE);
    writeConfig({ renders: true });
    const hook = startReconciler();
    const row = component('1');
    commit(hook, [fiber(FUNCTION, row)]);
    commit(hook, [fiber(FUNCTION, row)]);
    now.mockReturnValue(NEXT_DAY);
    commit(hook, [fiber(FUNCTION, row)]);
    hook?.flush();

    expect(dayFile('2026-10-11').commits).toBe(2);
    expect(dayFile('2026-10-12').commits).toBe(1);
    expect(dayFile('2026-10-12').components[0]?.renders).toBe(1);
  });

  test('sums commits and renders per activity, for the day and per component', () => {
    const now = spyOn(performance, 'now').mockReturnValue(1000);
    spyOn(Date, 'now').mockReturnValue(NOON);
    writeConfig({ renders: true });
    const hook = startReconciler();
    const row = component('1');
    hook?.typed();
    commit(hook, [fiber(FUNCTION, row, { actualDuration: 2 })]);
    now.mockReturnValue(5000);
    hook?.working({ session: 'main' }, 'streaming_assistant_message');
    commit(hook, [fiber(FUNCTION, row, { actualDuration: 3 })]);
    commit(hook, [fiber(FUNCTION, row, { actualDuration: 1 })]);
    hook?.flush();

    const written = dayFile('2026-10-11');
    expect(written.activities).toEqual({
      typing: { commits: 1, renderMs: 0, renders: 1 },
      streaming: { commits: 2, renderMs: 0, renders: 2 },
    });
    expect(written.components[0]?.activities).toEqual({ typing: [1, 2], streaming: [2, 4] });
  });

  test('counts changed hooks with their labels, and message snapshot changes by cause', () => {
    spyOn(Date, 'now').mockReturnValue(NOON);
    writeConfig({ renders: true });
    const hook = startReconciler();
    const type = component('0');
    commit(hook, [settingsChange(hook, type)]);
    commit(hook, [settingsChange(hook, type)]);
    hook?.flush();

    const [app] = dayFile('2026-10-11').components;
    expect(app?.hooks).toEqual({ 0: 2 });
    expect(app?.hookLabels?.[0]?.[0]).toBe(MESSAGES_HOOK);
    expect(app?.snapshots).toEqual({ settings_updated: 2 });
    expect(app?.sameSnapshots).toEqual({ settings_updated: 2 });
  });
});

function toggle(word?: string): string {
  return payloadFunction<[Require], (word?: string) => string>(
    ['require'],
    `return ${RENDERS_TOGGLE}`,
  )(stubRequire)(word);
}

describe('the /renders command', () => {
  test('on saves the setting, keeps the other keys and says where the data goes', () => {
    writeConfig({ width: 'full' });
    expect(toggle('on')).toBe(
      `Render recording on from the next Droid start. Data: ${factory()}/${RENDERS_DIR}. This Droid is not recording now.`,
    );
    expect(readConfig()).toEqual({ width: 'full', renders: true });
  });

  test('off saves false and says whether this Droid records now', () => {
    Reflect.set(globalThis, '$ODr', {});
    expect(toggle('OFF')).toBe(
      'Render recording off from the next Droid start. This Droid is recording now.',
    );
    expect(readConfig()).toEqual({ renders: false });
  });

  test('a bare command flips the saved setting', () => {
    expect(toggle()).toStartWith('Render recording on');
    expect(toggle()).toStartWith('Render recording off');
    expect(readConfig()).toEqual({ renders: false });
  });

  test('any other word prints the usage and whether this Droid records, and saves nothing', () => {
    expect(toggle('maybe')).toBe(`${RENDERS_USAGE}. This Droid is not recording now.`);
    expect(fs.existsSync(path.join(factory(), CONFIG_FILE))).toBe(false);
  });

  test('a failed save says so', () => {
    fs.writeFileSync(factory(), 'not a folder');
    expect(toggle('on')).toStartWith('Could not save the render recording setting: ');
  });
});
