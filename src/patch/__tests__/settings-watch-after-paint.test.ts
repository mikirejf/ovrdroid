import { beforeEach, describe, expect, test } from 'bun:test';

import { NO_PAINT_FALLBACK_MS, patches } from '../patches.ts';
import { describeStrayNames, patchNamed, payloadFunction } from './payload.ts';

interface Timer {
  run: () => void;
  ms: number;
  unrefed: boolean;
}

interface Manager {
  watchingEnabled: boolean;
  starts: number;
  enableWatching: () => void;
  disableWatching: () => void;
}

interface Painted {
  $ODpainted?: boolean;
  $ODafterPaint?: (() => void)[];
}

type SetTimeout = (run: () => void, ms: number) => { unref: () => void };

interface Stream {
  name: string;
}

const STOCK_MANAGER =
  'class Manager{watchingEnabled=!1;starts=0;' +
  'enableWatching(){if(this.watchingEnabled)return;this.watchingEnabled=!0,this.starts+=1}' +
  'disableWatching(){if(!this.watchingEnabled)return;this.watchingEnabled=!1}}';

const settingsWatchPatches = patches.filter((patch) => patch.name.startsWith('settings-watch-'));
const watch = patchNamed(settingsWatchPatches, 'settings-watch-after-paint');
const shell = patchNamed(settingsWatchPatches, 'settings-watch-after-paint-shell');
const ink = patchNamed(settingsWatchPatches, 'settings-watch-after-paint-ink');

let world: Painted = {};
let timers: Timer[] = [];

function fakeSetTimeout(run: () => void, ms: number): ReturnType<SetTimeout> {
  const timer = { run, ms, unrefed: false };
  timers.push(timer);
  return {
    unref: () => {
      timer.unrefed = true;
    },
  };
}

function fireTimers(upToMs: number): void {
  const due = timers.filter((timer) => timer.ms <= upToMs);
  timers = timers.filter((timer) => timer.ms > upToMs);
  for (const timer of due) {
    timer.run();
  }
}

function newManager(): Manager {
  const source = STOCK_MANAGER.replace(watch.find, watch.replace);
  expect(source).not.toBe(STOCK_MANAGER);
  const Patched = payloadFunction<[Painted, SetTimeout], new () => Manager>(
    ['globalThis', 'setTimeout'],
    `return ${source}`,
  )(world, fakeSetTimeout);
  return new Patched();
}

function flushShellFrame(): string[] {
  const written: string[] = [];
  const terminal = {
    write: (text: string) => {
      written.push(text);
      return true;
    },
  };
  const markers = { SYNC_OUTPUT_START: '<sync>', SYNC_OUTPUT_END: '</sync>' };
  payloadFunction<
    [Painted, SetTimeout, typeof terminal, typeof markers, string, string],
    undefined
  >(['globalThis', 'setTimeout', 'r', 'je', 't', 'e'], `let n,d,s,m;${shell.replace}0);`)(
    world,
    fakeSetTimeout,
    terminal,
    markers,
    '',
    'frame',
  );
  return written;
}

function renderInkFrame(stdout: Stream, processStdout: Stream): void {
  payloadFunction<[Painted, SetTimeout, { stdout: Stream }, Stream], undefined>(
    ['globalThis', 'setTimeout', 'process', 'stdout'],
    `({options:{stdout},${ink.replace}B=0;return E}}).renderInteractiveFrame("frame",1,"",!1);`,
  )(world, fakeSetTimeout, { stdout: processStdout }, stdout);
}

beforeEach(() => {
  world = {};
  timers = [];
});

describeStrayNames(settingsWatchPatches);

describe('the settings watchers start once the app frame reaches the terminal', () => {
  test('enabling before paint sets the flag at once and starts nothing', () => {
    const manager = newManager();
    manager.enableWatching();
    expect(manager.watchingEnabled).toBe(true);
    expect(manager.starts).toBe(0);
  });

  test('the early shell writing the first app frame starts them, after the frame', () => {
    const manager = newManager();
    manager.enableWatching();
    expect(flushShellFrame()).toEqual(['<sync>frame</sync>']);
    expect(manager.starts).toBe(0);
    fireTimers(0);
    expect(manager.starts).toBe(1);
    fireTimers(NO_PAINT_FALLBACK_MS);
    expect(manager.starts).toBe(1);
  });

  test('enabling after paint starts at once, as stock does', () => {
    flushShellFrame();
    fireTimers(0);
    const manager = newManager();
    manager.enableWatching();
    expect(manager.starts).toBe(1);
    expect(timers).toEqual([]);
  });

  test('a second manager enabled after paint starts at once, so the shared folders keep a subscriber', () => {
    const first = newManager();
    first.enableWatching();
    flushShellFrame();
    fireTimers(0);
    const second = newManager();
    second.enableWatching();
    expect([first.starts, second.starts]).toEqual([1, 1]);
  });

  test('disabling before paint keeps them stopped through paint and the fallback', () => {
    const manager = newManager();
    manager.enableWatching();
    manager.disableWatching();
    flushShellFrame();
    fireTimers(NO_PAINT_FALLBACK_MS);
    expect(manager.starts).toBe(0);
  });

  test('disabling and enabling again before paint starts them once', () => {
    const manager = newManager();
    manager.enableWatching();
    manager.disableWatching();
    manager.enableWatching();
    flushShellFrame();
    fireTimers(NO_PAINT_FALLBACK_MS);
    expect(manager.starts).toBe(1);
  });

  test('a run that never paints starts them at the fallback, on a timer that does not hold the process', () => {
    const manager = newManager();
    manager.enableWatching();
    expect(timers.map((timer) => [timer.ms, timer.unrefed])).toEqual([
      [NO_PAINT_FALLBACK_MS, true],
    ]);
    fireTimers(NO_PAINT_FALLBACK_MS);
    expect(manager.starts).toBe(1);
    flushShellFrame();
    fireTimers(0);
    expect(manager.starts).toBe(1);
  });

  test('without the early shell, an Ink frame written to the real stdout counts as paint', () => {
    const manager = newManager();
    manager.enableWatching();
    const stdout = { name: 'tty' };
    renderInkFrame(stdout, stdout);
    fireTimers(0);
    expect(manager.starts).toBe(1);
  });

  test("an Ink frame written into the early shell's buffer is not paint yet", () => {
    const manager = newManager();
    manager.enableWatching();
    renderInkFrame({ name: 'shell buffer' }, { name: 'tty' });
    fireTimers(0);
    expect(manager.starts).toBe(0);
    expect(world.$ODpainted).toBeUndefined();
  });
});
