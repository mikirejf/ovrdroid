import { describe, expect, test } from 'bun:test';

import { patchSource } from '../../binary/apply.ts';
import type { Rebase } from '../rebase.ts';
import { applies, rebaseAll } from '../rebase.ts';
import { todoRenderPatches } from '../todo-render-patches.ts';
import { sourceApp, STOCK } from './ink-frame-harness.ts';
import { patchNamed, payloadFunction, strayNames } from './payload.ts';

const SLOW_PATCH_MS = 120_000;

const rebases = rebaseAll(
  todoRenderPatches,
  (STOCK ?? []).map((module) => module.text),
);

function rebased(name: string): Rebase {
  const found = rebases.find((rebase) => rebase.name === name);
  if (found === undefined) {
    throw new Error(`${name} is missing from the todo render patches`);
  }
  return found;
}

describe('every name of three characters or fewer in a payload is captured or owned', () => {
  test.each(todoRenderPatches.map((patch) => [patch.name, patch] as const))(
    '%s',
    (_name, patch) => {
      expect(strayNames(patch)).toEqual([]);
    },
  );
});

describe.skipIf(STOCK === undefined)(
  'every todo render patch applies to the shipped bundle once',
  () => {
    test.each(todoRenderPatches.map((patch) => [patch.name] as const))('%s', (name) => {
      const rebase = rebased(name);
      expect(applies(rebase)).toBe(true);
      expect(rebase.matches).toBe(1);
    });

    test(
      'the patched chunk carries the memo',
      () => {
        const text = patchSource(sourceApp(), todoRenderPatches)
          .map((module) => module.text)
          .join('\n');
        const memo = rebased('todo-panel-memo');
        const panel = memo.renames['eG'] ?? 'eG';
        const memoName = memo.renames['Bg'] ?? 'Bg';
        expect(text).toContain(`${panel}=${memoName}(${panel});function ${panel}({todos:`);
      },
      SLOW_PATCH_MS,
    );

    test('the panel gets only bare identifiers, so a shallow compare can hold', () => {
      const panel = rebased('todo-panel-memo').renames['eG'] ?? 'eG';
      const text = sourceApp()
        .map((module) => module.text)
        .join('\n');
      const sites = text.match(
        new RegExp(`[\\w$]+\\(${panel.replace('$', '\\$')},\\{[^{}]*\\}\\)`, 'gu'),
      );
      expect(sites).toHaveLength(1);
      expect(sites?.[0]).toMatch(
        /^[\w$]+\([\w$]+,\{todos:[\w$]+,width:[\w$]+,maxVisibleRows:[\w$]+\}\)$/u,
      );
    });
  },
);

type Panel = () => null;

describe('todo-panel-memo', () => {
  const patch = patchNamed(todoRenderPatches, 'todo-panel-memo');

  test('wraps the panel in the plain memo, with no custom compare', () => {
    expect(patch.replace).toBe(`eG=Bg(eG);${patch.find}`);
  });

  test('the panel that renders is the memo, and it wraps the original', () => {
    const wrapped: Panel[] = [];
    const memo = (component: Panel) => {
      wrapped.push(component);
      return { memo: component };
    };
    const panel = payloadFunction<[typeof memo], unknown>(
      ['Bg'],
      `${patch.replace}}return eG`,
    )(memo);
    expect(wrapped).toHaveLength(1);
    expect(panel).toEqual({ memo: wrapped[0] });
    expect(wrapped[0]).toBeInstanceOf(Function);
  });
});
