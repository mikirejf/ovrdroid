import { describe, expect, test } from 'bun:test';

import type { Session } from './session-mention-harness.ts';
import { picker, session } from './session-mention-harness.ts';

describe('a refresh keeps the rows shown and appends the new matches', () => {
  const pool = ['a', 'b', 'c', 'd', 'e'].map((id, index) => session(id, id, index));
  const byId = (...ids: string[]): Session[] =>
    ids.map((id) => pool.find((row) => row.id === id)).filter((row) => row !== undefined);
  const keep = (ids: string[], now: string[], max = 100): (string | undefined)[] =>
    picker.$ODsessionKeep(ids, byId(...now), pool, max).map((row) => row.id);

  test('with nothing shown the matches come back in their own order', () => {
    expect(keep([], ['c', 'a', 'b'])).toEqual(['c', 'a', 'b']);
  });

  test('the rows shown keep their order even where the matches order them differently', () => {
    expect(keep(['c', 'a'], ['a', 'b', 'c'])).toEqual(['c', 'a', 'b']);
  });

  test('new matches follow in the order the matches give them', () => {
    expect(keep(['d'], ['a', 'd', 'b', 'e'])).toEqual(['d', 'a', 'b', 'e']);
  });

  test('a row shown that the matches no longer list is still kept', () => {
    expect(keep(['e', 'd'], ['a'])).toEqual(['e', 'd', 'a']);
  });

  test('the cap applies to the whole list, shown rows first', () => {
    expect(keep(['d', 'c'], ['a', 'b'], 3)).toEqual(['d', 'c', 'a']);
    expect(keep(['d', 'c'], ['a', 'b'], 2)).toEqual(['d', 'c']);
  });
});
