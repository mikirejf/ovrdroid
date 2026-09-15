import { describe, expect, test } from 'bun:test';

import { patches } from '../patches.ts';

interface Command {
  name: string;
  internalMenu: boolean;
  matchesName: boolean;
}

type Rank = (command: Command) => number;

const QUERY = 'del';

const patch = patches.find((entry) => entry.name === 'command-menu-prefix-first');

if (patch === undefined) {
  throw new TypeError('command-menu-prefix-first is missing from the patch list');
}

function buildRank(body: string): Rank {
  // SAFETY: the body is the patch payload, evaluated with the same bindings the
  // shipped bundle gives it: `g` the entry, `c` the lowercased query.
  // oxlint-disable-next-line no-new-func, typescript/no-implied-eval, typescript/no-unsafe-type-assertion, typescript/no-unsafe-call
  return new Function(
    'c',
    `return function(g){if(!g.matchesName)return 5;let R=g.name.toLowerCase();if(R===c)return 0;let A=g.internalMenu,S=R.startsWith(c);${body}`,
  )(QUERY) as Rank;
}

function nameMatches(name: string): boolean {
  let at = 0;
  for (const ch of name) {
    if (ch === QUERY[at]) {
      at += 1;
    }
  }
  return at === QUERY.length;
}

function command(name: string, internalMenu: boolean): Command {
  return { name, internalMenu, matchesName: nameMatches(name) };
}

const EXACT = command('del', false);
const BUILTIN_PREFIX = command('delete-thing', true);
const DELEGATE = command('delegate', false);
const MODEL = command('model', true);
const SKILL_INFIX = command('self-delegate', false);
const DESCRIPTION_ONLY = command('share', true);

const stock = buildRank(patch.find);
const patched = buildRank(patch.replace);

describe('the stock ranking is the bug being fixed', () => {
  test('a built-in non-prefix match outranks a skill that starts with the query', () => {
    expect(stock(MODEL)).toBeLessThan(stock(DELEGATE));
  });
});

describe('the patched ranking puts prefix matches first', () => {
  test('/delegate beats /model for the query "del"', () => {
    expect(patched(DELEGATE)).toBeLessThan(patched(MODEL));
  });

  test('an exact name still wins outright', () => {
    expect(patched(EXACT)).toBe(0);
  });

  test('a built-in prefix match still beats a custom prefix match', () => {
    expect(patched(BUILTIN_PREFIX)).toBeLessThan(patched(DELEGATE));
  });

  test('any prefix match beats any non-prefix match', () => {
    expect(patched(DELEGATE)).toBeLessThan(patched(MODEL));
    expect(patched(BUILTIN_PREFIX)).toBeLessThan(patched(MODEL));
  });

  test('a description-only match stays last', () => {
    expect(patched(DESCRIPTION_ONLY)).toBe(5);
  });

  test('every rank the stock code could return is still reachable and ordered', () => {
    const ranks = [EXACT, BUILTIN_PREFIX, DELEGATE, MODEL, SKILL_INFIX, DESCRIPTION_ONLY].map(
      (entry) => patched(entry),
    );
    expect(ranks).toEqual([0, 1, 2, 3, 4, 5]);
  });
});
