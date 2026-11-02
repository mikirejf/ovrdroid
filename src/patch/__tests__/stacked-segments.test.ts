import { describe, expect, test } from 'bun:test';

import { SEGMENTS, stackedViewPatches } from '../stacked-view-patches.ts';
import { patchNamed, payloadFunction } from './payload.ts';

interface Call {
  id: string;
  toolName: string;
}

const segments = payloadFunction<[], (calls: Call[]) => [string, Call[]][]>(
  [],
  `${SEGMENTS}return $ODsegments`,
)();

function counted(names: string[]): string[] {
  const calls = names.map((toolName, index) => ({ id: `c${index}`, toolName }));
  return segments(calls).map(([name, members]) => `${name} ${members.length}`);
}

describe('stacked segments', () => {
  test('keep the order the calls ran in and merge only neighbours of the same tool', () => {
    expect(counted(['Read', 'Read', 'Grep', 'Read', 'Execute', 'Execute'])).toEqual([
      'Read 2',
      'Grep 1',
      'Read 1',
      'Execute 2',
    ]);
  });

  test('a run of one tool is one segment', () => {
    expect(counted(['Read', 'Read', 'Read'])).toEqual(['Read 3']);
  });

  test('are drawn with a chevron between them', () => {
    const { replace } = patchNamed(stackedViewPatches, 'stacked-view-helpers');
    expect(replace).toContain(String.raw`children:" \u203A "`);
    expect(replace).not.toContain(String.raw`\xB7`);
  });
});
