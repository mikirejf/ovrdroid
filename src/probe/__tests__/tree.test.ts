import { describe, expect, test } from 'bun:test';

import { descendants, parseParents, shortCommand } from '../tree.ts';

const LISTING = [
  '  PID  PPID COMMAND',
  '  100     1 droid',
  '  200   100 /Users/x/.local/bin/droid exec --input-format stream-jsonrpc',
  '  300   200 rg --files',
  '  400     1 unrelated',
].join('\n');

describe('parseParents reads the ps listing', () => {
  test('a header line is skipped rather than parsed', () => {
    expect(parseParents(LISTING)).toHaveLength(4);
  });

  test('the command survives its spaces', () => {
    expect(parseParents(LISTING).at(1)?.command).toContain('exec --input-format');
  });
});

describe('shortCommand keeps the part that identifies a process', () => {
  test('the directory goes and the arguments stay', () => {
    expect(shortCommand('/Users/x/.local/bin/droid exec --input-format stream-jsonrpc')).toBe(
      'droid exec --input-format stream-jsonrpc',
    );
  });

  test('a bare name is left alone', () => {
    expect(shortCommand('droid')).toBe('droid');
  });
});

describe('descendants walks the whole tree, not just the children', () => {
  const rows = parseParents(LISTING);

  test('a grandchild is found, which is where droid exec lives', () => {
    expect(descendants(rows, 100).toSorted((a, b) => a - b)).toEqual([100, 200, 300]);
  });

  test('an unrelated process is left out', () => {
    expect(descendants(rows, 100)).not.toContain(400);
  });

  test('a leaf is its own tree', () => {
    expect(descendants(rows, 300)).toEqual([300]);
  });

  test('a cycle terminates rather than hanging', () => {
    expect(
      descendants(
        [
          { pid: 1, ppid: 2, command: 'a' },
          { pid: 2, ppid: 1, command: 'b' },
        ],
        1,
      ).toSorted((a, b) => a - b),
    ).toEqual([1, 2]);
  });
});
