import { describe, expect, test } from 'bun:test';

import { patchSource } from '../../binary/apply.ts';
import { joinApp } from '../../binary/graph.ts';
import type { Patch } from '../patches.ts';
import { rebaseAll } from '../rebase.ts';
import { suggestionListPatches } from '../suggestion-list-patches.ts';
import { arrowAt, evaluate, renamed } from './first-message-harness.ts';
import { patchNamed, rebasedNamed } from './payload.ts';
import type { Stand } from './session-mention-harness.ts';
import { stock } from './session-mention-harness.ts';
import { requireStock } from './stock-scanner.ts';

const ROWS = 5;
const COMMAND_MENU = 'command-menu-no-wrap';
const INPUT = { text: '/rew', cursor: 2 };

interface Key {
  upArrow?: boolean;
  downArrow?: boolean;
}

interface Draft {
  input: string;
  cursorPosition: number;
}

interface ListDriver {
  press: (key: Key) => number;
  savedDraft: { current?: Draft };
}

function handlerAround(text: string, anchor: string): string {
  const at = text.indexOf(anchor);
  if (at === -1) {
    throw new Error('the patched list key handler is missing');
  }
  return arrowAt(text, text.lastIndexOf('(', text.lastIndexOf('=>{', at)));
}

function listDriver(patch: Patch, start: number): ListDriver {
  const app = requireStock();
  const rebased = rebaseAll(
    [patch],
    app.map((module) => module.text),
  );
  const rebase = rebasedNamed(rebased, patch.name);
  const named = renamed(rebase);
  const handler = handlerAround(joinApp(patchSource(app, [patch])), rebase.replace);
  let selected = start;
  const savedDraft: ListDriver['savedDraft'] = {};
  const rows = Array.from({ length: ROWS }, (_row, index) => ({ name: `row${index}` }));
  const stubs = new Map<string, Stand>([
    [
      named('H'),
      () => ({
        showSuggestions: true,
        suggestions: rows,
        showCommands: true,
        filteredCommands: rows,
      }),
    ],
    [
      named('x2'),
      (step: (index: number) => number) => {
        selected = step(selected);
      },
    ],
    [named('I'), (key: Key, name: keyof Key) => key[name] === true],
  ]);
  if (patch.name === COMMAND_MENU) {
    stubs.set(named('Pe'), { getState: () => ({ active: INPUT }) });
    stubs.set(named('Y1'), savedDraft);
  }
  const press = evaluate<(key: Key) => boolean>(handler, stubs);
  return {
    press: (key) => {
      expect(press(key)).toBe(true);
      return selected;
    },
    savedDraft,
  };
}

function holdKey(patch: Patch, start: number, key: Key): number[] {
  const { press } = listDriver(patch, start);
  return Array.from({ length: ROWS + 2 }, () => press(key));
}

describe
  .skipIf(stock === undefined)
  .each(suggestionListPatches.map((patch) => [patch.name, patch] as const))(
  '%s: holding an arrow key stops at the end of the list',
  (_name, patch) => {
    test('Up stops at the first row', () => {
      expect(holdKey(patch, 2, { upArrow: true })).toEqual([1, 0, 0, 0, 0, 0, 0]);
    });

    test('Down stops at the last row', () => {
      expect(holdKey(patch, 2, { downArrow: true })).toEqual([3, 4, 4, 4, 4, 4, 4]);
    });
  },
);

test.skipIf(stock === undefined).each([
  ['Up', 0, { upArrow: true }],
  ['Down', ROWS - 1, { downArrow: true }],
] as const)('command menu %s saves the active draft even at the boundary', (_name, edge, key) => {
  const { press, savedDraft } = listDriver(patchNamed(suggestionListPatches, COMMAND_MENU), edge);
  expect(press(key)).toBe(edge);
  expect(savedDraft.current).toEqual({ input: INPUT.text, cursorPosition: INPUT.cursor });
});
