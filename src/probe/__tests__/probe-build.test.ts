import { describe, expect, test } from 'bun:test';

import { withoutNamed } from '../probe-build.ts';

const list = [
  { name: 'a', find: 'x', replace: 'y' },
  { name: 'b', find: 'x', replace: 'y' },
];

describe('withoutNamed', () => {
  test('drops the named patches and keeps the rest in order', () => {
    expect(withoutNamed(list, ['a']).map((patch) => patch.name)).toEqual(['b']);
  });

  test('dropping a patch also drops the companions named after it', () => {
    const family = [...list, { name: 'a-undo', find: 'x', replace: 'y' }];
    expect(withoutNamed(family, ['a']).map((patch) => patch.name)).toEqual(['b']);
  });

  test('a misspelt name fails instead of building the full set', () => {
    expect(() => withoutNamed(list, ['c'])).toThrow('no patch named c');
  });
});
