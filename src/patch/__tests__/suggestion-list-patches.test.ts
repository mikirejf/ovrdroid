import { describe, expect, test } from 'bun:test';

import { patchSource } from '../../binary/apply.ts';
import type { App } from '../../binary/graph.ts';
import { joinApp } from '../../binary/graph.ts';
import type { Patch } from '../patches.ts';
import { rebaseAll } from '../rebase.ts';
import { suggestionListPatches } from '../suggestion-list-patches.ts';
import { blockEnd } from '../tokens.ts';
import { payloadFunction } from './payload.ts';
import type { Stand } from './session-mention-harness.ts';
import { scoped, scopeOver, stock } from './session-mention-harness.ts';

const ROWS = 5;

interface Key {
  upArrow?: boolean;
  downArrow?: boolean;
}

type Press = (key: Key) => number;

function handlerAfter(text: string, anchor: string): string {
  const at = text.indexOf(anchor);
  if (at === -1) {
    throw new Error('the patched list key handler is missing');
  }
  const start = text.indexOf('(', at) + 1;
  return text.slice(start, blockEnd(text, text.indexOf('=>{', start) + 2) + 1);
}

function stockApp(): App {
  if (stock === undefined) {
    throw new Error('no stock Droid to read');
  }
  return stock;
}

function listDriver(patch: Patch, start: number): Press {
  const app = stockApp();
  const [rebase] = rebaseAll(
    [patch],
    app.map((module) => module.text),
  );
  if (rebase === undefined) {
    throw new Error(`${patch.name} did not rebase`);
  }
  const renames = new Map(Object.entries(rebase.renames));
  const named = (name: string): string => renames.get(name) ?? name;
  const handler = handlerAfter(joinApp(patchSource(app, [patch])), rebase.replace);
  let selected = start;
  const rows = Array.from({ length: ROWS }, (_row, index) => ({ name: `row${index}` }));
  const stubs = new Map<string, Stand>([
    [
      named('G'),
      () => ({
        showSuggestions: true,
        suggestions: rows,
        showCommands: true,
        filteredCommands: rows,
      }),
    ],
    [
      named('kt'),
      (step: (index: number) => number) => {
        selected = step(selected);
      },
    ],
  ]);
  const press = payloadFunction<
    [ReturnType<typeof scopeOver>],
    (input: string, key: Key) => boolean
  >(
    ['$ODscope'],
    scoped(handler),
  )(scopeOver(stubs));
  return (key) => {
    press('', key);
    return selected;
  };
}

function holdKey(patch: Patch, start: number, key: Key): number[] {
  const press = listDriver(patch, start);
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
