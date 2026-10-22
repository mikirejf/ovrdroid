import { describe, expect, test } from 'bun:test';

import { expandEnv } from '../credentials.ts';

function reference(name: string): string {
  return `\${${name}}`;
}

describe('expandEnv', () => {
  test('replaces a reference apiKey with the value Droid would read from the environment', () => {
    expect(expandEnv(reference('CLIPROXY_API_KEY'), { CLIPROXY_API_KEY: 'sk-real' })).toBe(
      'sk-real',
    );
  });

  test('expands every reference inside a longer value and leaves literal text alone', () => {
    expect(expandEnv(`Bearer ${reference('A')}-${reference('B_2')}`, { A: 'x', B_2: 'y' })).toBe(
      'Bearer x-y',
    );
    expect(expandEnv('sk-plain', {})).toBe('sk-plain');
  });

  test('throws naming the variable when the environment does not set it', () => {
    expect(() => expandEnv(reference('MISSING_KEY'), {})).toThrow('MISSING_KEY');
  });
});
