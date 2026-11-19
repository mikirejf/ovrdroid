import { describe, expect, test } from 'bun:test';

import { subagentsTabPatches } from '../subagents-tab-patches.ts';
import { patchNamed, payloadFunction } from './payload.ts';

interface Session {
  id: string;
  tags: string[];
}

const patch = patchNamed(subagentsTabPatches, 'session-rewind-marker');

function marker(
  source: string,
  tags: string[],
  { depth, width = 80 }: { depth?: number; width?: number } = {},
): string {
  return payloadFunction<[Map<string, number>, { session: Session }, number], string>(
    ['V1', 'Vt', 'B2'],
    `let ${source}return i3`,
  )(
    new Map(depth === undefined ? [] : [['session', depth]]),
    { session: { id: 'session', tags } },
    width,
  );
}

describe('session fork markers', () => {
  test('a rewind replaces the stock fork arrow with the rewind marker', () => {
    expect(marker(patch.find, ['rewind'], { depth: 1 })).toBe('↳ ');
    expect(marker(patch.replace, ['rewind'], { depth: 1 })).toBe('⟲ rewind ');
  });

  test.each([[], ['subagent'], ['btw'], ['not-rewind']])(
    'a non-rewind fork keeps its stock marker with tags %j',
    (...tags) => {
      expect(marker(patch.replace, tags, { depth: 2 })).toBe(
        marker(patch.find, tags, { depth: 2 }),
      );
      expect(marker(patch.replace, tags, { depth: 2 })).toBe('  ↳ ');
    },
  );

  test('the rewind tag is recognized among other tag names', () => {
    expect(marker(patch.replace, ['favorite', 'rewind', 'read-only'], { depth: 1 })).toBe(
      '⟲ rewind ',
    );
  });

  test('nested rewinds keep the stock two-space indentation', () => {
    expect(marker(patch.replace, ['rewind'], { depth: 3 })).toBe('    ⟲ rewind ');
  });

  test('deep rewinds keep the stock terminal-width indentation cap', () => {
    expect(marker(patch.replace, ['rewind'], { depth: 20, width: 12 })).toBe('      ⟲ rewind ');
  });

  test.each([[], ['rewind']])('a root row with tags %j stays unmarked', (...tags) => {
    expect(marker(patch.replace, tags, { depth: 0 })).toBe('');
    expect(marker(patch.replace, tags)).toBe('');
  });
});
