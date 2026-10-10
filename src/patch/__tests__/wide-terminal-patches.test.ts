import { describe, expect, test } from 'bun:test';

import {
  DEFAULT_ON_WIDTH,
  MIN_MAX_WIDTH,
  WIDTH_USAGE,
  wideTerminalPatches,
} from '../wide-terminal-patches.ts';
import { patchNamed, payloadFunction } from './payload.ts';
import { UNSET, helpersWith } from './wide-terminal-harness.ts';

describe('layout width', () => {
  test('with nothing set, centering is off and the terminal keeps its width', () => {
    expect(helpersWith(UNSET).boxWidth(300)).toBe(300);
    expect(helpersWith(UNSET).boxWidth(100)).toBe(100);
  });

  test('a narrow terminal keeps its own width', () => {
    expect(helpersWith('120').boxWidth(100)).toBe(100);
  });

  test('a number in the variable sets the width', () => {
    expect(helpersWith('100').boxWidth(300)).toBe(100);
  });

  test.each(['0', 'off', 'no'])('%s turns centering off', (setting) => {
    expect(helpersWith(setting).boxWidth(300)).toBe(300);
  });

  test('a tiny number is raised to the minimum', () => {
    expect(helpersWith('10').boxWidth(300)).toBe(MIN_MAX_WIDTH);
  });
});

describe('centering text', () => {
  test('every non-empty line moves right by half the spare room', () => {
    expect(helpersWith('100', { columns: 200 }).centerText('one\n\ntwo')).toBe(
      `${' '.repeat(50)}one\n\n${' '.repeat(50)}two`,
    );
  });

  test('a bare newline stays bare', () => {
    const helpers = helpersWith('100', { columns: 200 });
    expect(helpers.centerText('old\n')).toBe(`${' '.repeat(50)}old\n`);
    expect(helpers.centerText('\n')).toBe('\n');
  });

  test('an odd spare room puts the extra column on the right', () => {
    expect(helpersWith('100', { columns: 201 }).centerText('x')).toBe(`${' '.repeat(50)}x`);
  });

  test('a terminal at or under the width leaves the text alone', () => {
    expect(helpersWith('100', { columns: 100 }).centerText('x\ny')).toBe('x\ny');
  });

  test('turned off, the text is left alone', () => {
    expect(helpersWith('0', { columns: 200 }).centerText('x')).toBe('x');
  });

  test('empty text comes back as it came', () => {
    expect(helpersWith('100', { columns: 200 }).centerText('')).toBe('');
  });

  test('a terminal with no known width counts as 80 columns', () => {
    const helpers = helpersWith('60', { columns: 0 });
    expect(helpers.centerText('x')).toBe(`${' '.repeat(10)}x`);
  });

  test('colour codes after the line start stay where they are', () => {
    expect(helpersWith('100', { columns: 200 }).centerText('\u001B[1mhi\u001B[0m')).toBe(
      `${' '.repeat(50)}\u001B[1mhi\u001B[0m`,
    );
  });

  test('the next resize moves the centering with the terminal', () => {
    const helpers = helpersWith('140', { columns: 200 });
    expect(helpers.centerText('x')).toBe(`${' '.repeat(30)}x`);
    helpers.setColumns(240);
    expect(helpers.centerText('x')).toBe(`${' '.repeat(50)}x`);
  });
});

describe('the width command', () => {
  test('with no argument it turns centering off, then back on at the same width', () => {
    const helpers = helpersWith('100');
    expect(helpers.setWidth()).toBe('Centered layout off');
    expect(helpers.boxWidth(300)).toBe(300);
    expect(helpers.setWidth()).toBe('Centered layout on, max width 100 columns');
    expect(helpers.boxWidth(300)).toBe(100);
  });

  test('with nothing set, the toggle turns centering on at the default on-width', () => {
    const helpers = helpersWith(UNSET);
    expect(helpers.setWidth()).toBe(`Centered layout on, max width ${DEFAULT_ON_WIDTH} columns`);
    expect(helpers.boxWidth(300)).toBe(DEFAULT_ON_WIDTH);
  });

  test('on after starting with it off uses the default on-width', () => {
    const helpers = helpersWith('off');
    expect(helpers.setWidth('on')).toBe(
      `Centered layout on, max width ${DEFAULT_ON_WIDTH} columns`,
    );
    expect(helpers.boxWidth(300)).toBe(DEFAULT_ON_WIDTH);
  });

  test('off and a column count are accepted in any case', () => {
    const helpers = helpersWith(UNSET);
    helpers.setWidth('OFF');
    expect(helpers.boxWidth(300)).toBe(300);
    helpers.setWidth('90');
    expect(helpers.boxWidth(300)).toBe(90);
  });

  test('a bad argument changes nothing and says how to use the command', () => {
    const helpers = helpersWith('100');
    expect(helpers.setWidth('wide')).toBe(WIDTH_USAGE);
    expect(helpers.boxWidth(300)).toBe(100);
    expect(helpers.repaints()).toBe(0);
  });

  test('every change asks the terminal to repaint once', () => {
    const helpers = helpersWith(UNSET);
    helpers.setWidth();
    helpers.setWidth('120');
    expect(helpers.repaints()).toBe(2);
  });
});

const WATCHER_STOCK =
  'let U=null,z=d.columns,q=!1,Z=()=>{U=null;let X=H.current,ne=q;switch(q=!1,bX[X.getScreenName()]){' +
  'case"rebuildChatOnWidthChange":if(ne)X.rebuildChatSession();break}},' +
  'J=eM(d,()=>{if(d.columns!==z)z=d.columns,q=!0;if(U!==null)clearTimeout(U);U=setTimeout(Z,L)});' +
  'return()=>{if(U!==null)clearTimeout(U);J()}';

const WATCHER_PATCHES = ['wide-terminal-resize-watch-start', 'wide-terminal-resize-watch-compare'];

function patchedWatcher(): string {
  let source = WATCHER_STOCK;
  for (const name of WATCHER_PATCHES) {
    const { find, replace } = patchNamed(wideTerminalPatches, name);
    expect(source).toContain(find);
    source = source.replace(find, () => replace);
  }
  return source;
}

interface Terminal {
  columns: number;
}

interface Chat {
  rebuildChatSession: () => void;
  getScreenName: () => string;
}

interface WatcherRuntime {
  globalThis: { __odBoxWidth: (cols: number) => number };
  setTimeout: (run: () => void) => number;
  clearTimeout: () => null;
}

interface Watcher {
  terminal: Terminal;
  setWidth: (argument?: string) => string;
  resize: (columns: number) => void;
  rebuilds: () => number;
}

function watcherWith(setting: string): Watcher {
  let rebuilds = 0;
  const listeners: (() => void)[] = [];
  const terminal: Terminal = { columns: 200 };
  const chat: Chat = {
    rebuildChatSession: () => {
      rebuilds += 1;
    },
    getScreenName: () => 'chat',
  };
  const fireResize = (): void => {
    for (const listener of listeners) {
      listener();
    }
  };
  const helpers = helpersWith(setting, { onResize: fireResize });
  const runtime: WatcherRuntime = {
    globalThis: { __odBoxWidth: helpers.boxWidth },
    setTimeout: (run) => {
      run();
      return 0;
    },
    clearTimeout: () => null,
  };
  payloadFunction<
    [
      Terminal,
      { current: Chat },
      Record<string, string>,
      (target: Terminal, listener: () => void) => () => null,
      number,
      WatcherRuntime['globalThis'],
      WatcherRuntime['setTimeout'],
      WatcherRuntime['clearTimeout'],
    ],
    () => void
  >(['d', 'H', 'bX', 'eM', 'L', 'globalThis', 'setTimeout', 'clearTimeout'], patchedWatcher())(
    terminal,
    { current: chat },
    { chat: 'rebuildChatOnWidthChange' },
    (_target, listener) => {
      listeners.push(listener);
      return () => null;
    },
    0,
    runtime.globalThis,
    runtime.setTimeout,
    runtime.clearTimeout,
  );
  return {
    terminal,
    setWidth: helpers.setWidth,
    resize: (columns) => {
      terminal.columns = columns;
      fireResize();
    },
    rebuilds: () => rebuilds,
  };
}

describe('the chat rebuild on a width change', () => {
  test('changing the maximum width rebuilds the chat although the terminal did not change', () => {
    const watcher = watcherWith('140');
    watcher.setWidth('90');
    expect(watcher.terminal.columns).toBe(200);
    expect(watcher.rebuilds()).toBe(1);
  });

  test('turning centering off and on again rebuilds each time', () => {
    const watcher = watcherWith('140');
    watcher.setWidth('off');
    watcher.setWidth();
    expect(watcher.rebuilds()).toBe(2);
  });

  test('setting the same width again does not rebuild', () => {
    const watcher = watcherWith('140');
    watcher.setWidth('140');
    watcher.setWidth('on');
    expect(watcher.rebuilds()).toBe(0);
  });

  test('a real resize that changes the capped width rebuilds', () => {
    const watcher = watcherWith('140');
    watcher.resize(100);
    expect(watcher.rebuilds()).toBe(1);
  });

  test('a real resize that stays above the cap still rebuilds, because the centering moves', () => {
    const watcher = watcherWith('140');
    watcher.resize(260);
    expect(watcher.rebuilds()).toBe(1);
  });

  test('a resize event with the same columns and the same width does not rebuild', () => {
    const watcher = watcherWith('140');
    watcher.resize(200);
    expect(watcher.rebuilds()).toBe(0);
  });

  test('turned off, a real resize still rebuilds', () => {
    const watcher = watcherWith('0');
    watcher.resize(260);
    expect(watcher.rebuilds()).toBe(1);
  });
});

const SIZE_STOCK = `function X9(d){let f=dE(d.columns,iy),E=dE(d.rows,Gy);return\`\${f}x\${E}\`}return X9`;

interface Size {
  columns: number;
  rows: number;
}

function sizeSnapshotWith(setting: string): (size: Size) => string {
  const { find, replace } = patchNamed(wideTerminalPatches, 'wide-terminal-size-hook');
  expect(SIZE_STOCK).toContain(find);
  const { boxWidth } = helpersWith(setting);
  return payloadFunction<
    [(value: number, fallback: number) => number, number, number, unknown],
    (size: Size) => string
  >(
    ['dE', 'iy', 'Gy', 'globalThis'],
    SIZE_STOCK.replace(find, () => replace),
  )((value) => value, 80, 24, { __odBoxWidth: boxWidth });
}

describe('the terminal size snapshot that wakes the resize watcher', () => {
  test('changes when only the raw columns change above the cap', () => {
    const snapshot = sizeSnapshotWith('140');
    expect(snapshot({ columns: 200, rows: 50 })).not.toBe(snapshot({ columns: 240, rows: 50 }));
  });

  test('keeps the capped width and the rows in its first two parts', () => {
    const [width, rows] = sizeSnapshotWith('140')({ columns: 200, rows: 50 }).split('x');
    expect([width, rows]).toEqual(['140', '50']);
  });

  test('stays the same when nothing changes', () => {
    const snapshot = sizeSnapshotWith('140');
    expect(snapshot({ columns: 200, rows: 50 })).toBe(snapshot({ columns: 200, rows: 50 }));
  });
});
