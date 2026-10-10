import { describe, expect, test } from 'bun:test';

import {
  CONFIG_FILE,
  DEFAULT_MAX_WIDTH,
  MIN_MAX_WIDTH,
  SAVED_LAST_WIDTH_KEY,
  SAVED_WIDTH_KEY,
  WIDTH_COMMAND,
  WIDTH_USAGE,
} from '../wide-terminal-patches.ts';
import { payloadFunction } from './payload.ts';
import type { FailingStep, Helpers } from './wide-terminal-harness.ts';
import { DISK_FAILURE, FAKE_HOME, UNSET, helpersWith, patched } from './wide-terminal-harness.ts';

interface SavedFile {
  maxWidth?: number | string;
  lastMaxWidth?: number | string;
  other?: { nested: boolean };
  added?: number;
}

function file(contents: SavedFile): string {
  return JSON.stringify(contents);
}

function started(contents: SavedFile): Helpers {
  return helpersWith(UNSET, { saved: file(contents) });
}

function expectSaved(helpers: Helpers, expected: SavedFile): void {
  expect(JSON.parse(helpers.savedText() ?? 'null')).toEqual(expected);
}

describe('the width saved in the ovrdroid file', () => {
  test('a saved width is used from the start', () => {
    expect(started({ [SAVED_WIDTH_KEY]: 90 }).boxWidth(300)).toBe(90);
  });

  test('a saved 0 starts with centering off', () => {
    expect(started({ [SAVED_WIDTH_KEY]: 0 }).boxWidth(300)).toBe(300);
  });

  test('on after a saved off returns to the saved last width', () => {
    const helpers = started({ [SAVED_WIDTH_KEY]: 0, [SAVED_LAST_WIDTH_KEY]: 110 });
    helpers.setWidth('on');
    expect(helpers.boxWidth(300)).toBe(110);
  });

  test('the toggle after a saved off returns to the saved last width', () => {
    const helpers = started({ [SAVED_WIDTH_KEY]: 0, [SAVED_LAST_WIDTH_KEY]: 110 });
    expect(helpers.setWidth()).toBe('Centered layout on, max width 110 columns');
  });

  test('on after a saved off without a last width uses the default width', () => {
    const helpers = started({ [SAVED_WIDTH_KEY]: 0 });
    helpers.setWidth('on');
    expect(helpers.boxWidth(300)).toBe(DEFAULT_MAX_WIDTH);
  });

  test('a tiny saved width is raised to the minimum', () => {
    expect(started({ [SAVED_WIDTH_KEY]: 10 }).boxWidth(300)).toBe(MIN_MAX_WIDTH);
  });

  test('the variable wins over the saved width', () => {
    const saved = file({ [SAVED_WIDTH_KEY]: 90 });
    expect(helpersWith('120', { saved }).boxWidth(300)).toBe(120);
    expect(helpersWith('0', { saved }).boxWidth(300)).toBe(300);
  });

  test('an empty variable counts as unset, so the saved width is used', () => {
    const saved = file({ [SAVED_WIDTH_KEY]: 90 });
    expect(helpersWith('', { saved }).boxWidth(300)).toBe(90);
  });

  test('with the variable set, on returns to the saved last width', () => {
    const helpers = helpersWith('0', { saved: file({ [SAVED_LAST_WIDTH_KEY]: 110 }) });
    helpers.setWidth('on');
    expect(helpers.boxWidth(300)).toBe(110);
  });

  test.each([
    ['a garbled file', '{"maxWidth": 9'],
    ['a file holding null', 'null'],
    ['a file holding a list', '[90]'],
    ['a file holding text', '"wide"'],
    ['a width written as text', '{"maxWidth":"90"}'],
    ['a negative width', file({ [SAVED_WIDTH_KEY]: -5 })],
    ['a file without the key', file({})],
  ])('%s falls back to the default width', (_label, saved) => {
    expect(helpersWith(UNSET, { saved }).boxWidth(300)).toBe(DEFAULT_MAX_WIDTH);
  });

  test('a last width of the wrong type is ignored', () => {
    const helpers = started({ [SAVED_WIDTH_KEY]: 0, [SAVED_LAST_WIDTH_KEY]: 'wide' });
    helpers.setWidth('on');
    expect(helpers.boxWidth(300)).toBe(DEFAULT_MAX_WIDTH);
  });

  test('a missing file falls back to the default width', () => {
    expect(helpersWith(UNSET).boxWidth(300)).toBe(DEFAULT_MAX_WIDTH);
  });

  test('the file is read from the Factory home override, or else from the home folder', () => {
    const elsewhere = helpersWith(UNSET, { home: '/tmp/elsewhere' });
    expect(elsewhere.filesRead()).toEqual([`/tmp/elsewhere/.factory/${CONFIG_FILE}`]);
    expect(helpersWith(UNSET).filesRead()).toEqual([`${FAKE_HOME}/.factory/${CONFIG_FILE}`]);
  });
});

describe('saving a width change', () => {
  test('a new width is saved with the width that on returns to', () => {
    const helpers = helpersWith(UNSET);
    helpers.setWidth('90');
    expectSaved(helpers, { [SAVED_WIDTH_KEY]: 90, [SAVED_LAST_WIDTH_KEY]: 90 });
  });

  test('keys the file already holds stay', () => {
    const helpers = started({ other: { nested: true }, [SAVED_WIDTH_KEY]: 50 });
    helpers.setWidth('90');
    expectSaved(helpers, {
      other: { nested: true },
      [SAVED_WIDTH_KEY]: 90,
      [SAVED_LAST_WIDTH_KEY]: 90,
    });
  });

  test('keys added by another process after the start stay', () => {
    const helpers = started({ [SAVED_WIDTH_KEY]: 50 });
    helpers.disk.files.set(helpers.configPath, file({ added: 1 }));
    helpers.setWidth('90');
    expectSaved(helpers, {
      added: 1,
      [SAVED_WIDTH_KEY]: 90,
      [SAVED_LAST_WIDTH_KEY]: 90,
    });
  });

  test('off is saved as 0 and keeps the last width', () => {
    const helpers = started({ [SAVED_WIDTH_KEY]: 100, [SAVED_LAST_WIDTH_KEY]: 100 });
    helpers.setWidth('off');
    expectSaved(helpers, { [SAVED_WIDTH_KEY]: 0, [SAVED_LAST_WIDTH_KEY]: 100 });
  });

  test('on after off saves the width again', () => {
    const helpers = started({ [SAVED_WIDTH_KEY]: 100, [SAVED_LAST_WIDTH_KEY]: 100 });
    helpers.setWidth('off');
    helpers.setWidth();
    expectSaved(helpers, { [SAVED_WIDTH_KEY]: 100, [SAVED_LAST_WIDTH_KEY]: 100 });
  });

  test('a width set while the variable is on is saved too', () => {
    const helpers = helpersWith('120');
    helpers.setWidth('90');
    expectSaved(helpers, { [SAVED_WIDTH_KEY]: 90, [SAVED_LAST_WIDTH_KEY]: 90 });
  });

  test('a garbled file is replaced by a valid one', () => {
    const helpers = helpersWith(UNSET, { saved: '{"maxWidth": 9' });
    helpers.setWidth('90');
    expectSaved(helpers, { [SAVED_WIDTH_KEY]: 90, [SAVED_LAST_WIDTH_KEY]: 90 });
  });

  test('the file is a readable object with a final newline', () => {
    const helpers = helpersWith(UNSET);
    helpers.setWidth('90');
    expect(helpers.disk.files.get(helpers.configPath)).toBe(
      `{\n  "${SAVED_WIDTH_KEY}": 90,\n  "${SAVED_LAST_WIDTH_KEY}": 90\n}\n`,
    );
  });

  test('the folder is made, then a temporary file is written and renamed over the target', () => {
    const helpers = helpersWith(UNSET);
    helpers.setWidth('90');
    expect(helpers.disk.changes).toEqual([
      `mkdir ${FAKE_HOME}/.factory`,
      `write ${helpers.tempPath}`,
      `rename ${helpers.tempPath} ${helpers.configPath}`,
    ]);
    expect([...helpers.disk.files.keys()]).toEqual([helpers.configPath]);
  });

  test('a width saved by one run is the start width of the next', () => {
    const first = helpersWith(UNSET);
    first.setWidth('90');
    const second = helpersWith(UNSET, { saved: first.savedText() });
    expect(second.boxWidth(300)).toBe(90);
  });

  test('a bad argument saves nothing', () => {
    const helpers = started({ [SAVED_WIDTH_KEY]: 100 });
    expect(helpers.setWidth('wide')).toBe(WIDTH_USAGE);
    expect(helpers.disk.changes).toEqual([]);
  });

  test('the message stays plain when the save works', () => {
    expect(helpersWith(UNSET).setWidth('90')).toBe('Centered layout on, max width 90 columns');
  });

  test.each<[FailingStep]>([['mkdir'], ['write'], ['rename']])(
    'a failed %s is reported in the message and the width still changes',
    (failingStep) => {
      const helpers = helpersWith(UNSET, { failingStep });
      expect(helpers.setWidth('90')).toBe(
        `Centered layout on, max width 90 columns (could not save: ${DISK_FAILURE})`,
      );
      expect(helpers.boxWidth(300)).toBe(90);
      expect(helpers.repaints()).toBe(1);
    },
  );

  test('a failed rename removes the temporary file and leaves the old file alone', () => {
    const helpers = helpersWith(UNSET, {
      saved: file({ [SAVED_WIDTH_KEY]: 100 }),
      failingStep: 'rename',
    });
    helpers.setWidth('90');
    expect(helpers.disk.changes).toEqual([
      `mkdir ${FAKE_HOME}/.factory`,
      `write ${helpers.tempPath}`,
      `remove ${helpers.tempPath}`,
    ]);
    expectSaved(helpers, { [SAVED_WIDTH_KEY]: 100 });
  });
});

const COMMAND_MAP_STOCK = 'var o={vim:Cs,commands:Me()},_s={};return o';

interface Command {
  execute: (args: string[], context: Context) => { handled: boolean };
}

interface MessageOptions {
  messageType: string;
  visibility: string;
}

interface Context {
  addEphemeralSystemMessage: (text: string, options: MessageOptions) => void;
}

interface Run {
  messages: string[];
  handled: boolean;
  helpers: Helpers;
}

function runCommand(args: string[], failingStep?: FailingStep): Run {
  const helpers = helpersWith(UNSET, failingStep === undefined ? {} : { failingStep });
  const run: Run = { messages: [], handled: false, helpers };
  const map = payloadFunction<
    [(command: Command) => Command, object, () => object, object],
    Record<string, Command>
  >(['Gc', 'Cs', 'Me', 'globalThis'], patched(COMMAND_MAP_STOCK, 'wide-terminal-command'))(
    (command) => command,
    {},
    () => ({}),
    { __odSetWidth: helpers.setWidth },
  );
  const command = map[WIDTH_COMMAND];
  if (command === undefined) {
    throw new TypeError('the width command is missing from the map');
  }
  run.handled = command.execute(args, {
    addEphemeralSystemMessage: (text) => {
      run.messages.push(text);
    },
  }).handled;
  return run;
}

describe('the width command in the command map', () => {
  test('it changes the width, saves it and reports the change', () => {
    const run = runCommand(['90']);
    expectSaved(run.helpers, { [SAVED_WIDTH_KEY]: 90, [SAVED_LAST_WIDTH_KEY]: 90 });
    expect(run.messages).toEqual(['Centered layout on, max width 90 columns']);
    expect(run.handled).toBe(true);
  });

  test('a bad argument writes nothing', () => {
    const run = runCommand(['wide']);
    expect(run.helpers.disk.changes).toEqual([]);
    expect(run.messages).toEqual([WIDTH_USAGE]);
  });

  test('a failed save is reported in the chat and the command still ends', () => {
    const run = runCommand(['90'], 'write');
    expect(run.messages).toEqual([
      `Centered layout on, max width 90 columns (could not save: ${DISK_FAILURE})`,
    ]);
    expect(run.handled).toBe(true);
  });
});
