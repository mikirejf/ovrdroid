import { afterAll, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { HEAP_VARIABLE } from '../../patch/heap-patches.ts';
import { LAG_VARIABLE } from '../../patch/lag-patches.ts';
import { chooseFiles, filesMatching, largestOf, sessionEnv } from '../subagents-setup.ts';

const dir = mkdtempSync(path.join(tmpdir(), 'subagents-setup-'));
mkdirSync(path.join(dir, 'src', 'deep'), { recursive: true });
function put(name: string, bytes: number): string {
  const file = path.join(dir, name);
  writeFileSync(file, 'x'.repeat(bytes));
  return file;
}
const small = put('src/small.ts', 10);
const big = put('src/deep/big.ts', 5000);
const medium = put('src/medium.ts', 500);
const other = put('src/notes.md', 99_999);
const same = put('src/same.ts', 500);

afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('filesMatching expands globs to absolute paths', () => {
  test('a recursive glob finds nested files and skips other kinds', () => {
    const found = filesMatching(['src/**/*.ts'], dir);
    expect(found).toContain(big);
    expect(found).not.toContain(other);
  });

  test('two globs that overlap list a file once', () => {
    const found = filesMatching(['src/*.ts', 'src/small.ts'], dir);
    expect(found.filter((file) => file === small)).toHaveLength(1);
  });

  test('a glob with no match is an error that names it', () => {
    expect(() => filesMatching(['nothing/**/*.ts'], dir)).toThrow('no file matches nothing');
  });
});

describe('largestOf keeps the biggest files', () => {
  test('biggest first, ties by name', () => {
    expect(largestOf([small, medium, big, same], 3)).toEqual([big, medium, same]);
  });

  test('a limit above the count keeps them all', () => {
    expect(largestOf([small, big], 10)).toEqual([big, small]);
  });
});

describe('chooseFiles', () => {
  test('without globs it picks the four largest .ts files of this repo, as absolute paths', () => {
    const files = chooseFiles();
    expect(files).toHaveLength(4);
    expect(files.every((file) => path.isAbsolute(file) && file.endsWith('.ts'))).toBe(true);
    expect(files.every((file) => file.includes(`${path.sep}src${path.sep}`))).toBe(true);
  });

  test('the same call gives the same files', () => {
    expect(chooseFiles()).toEqual(chooseFiles());
  });
});

describe('sessionEnv sets the variables of the builds that are on', () => {
  test('heap and lag each get their file', () => {
    expect(sessionEnv({ heap: '/a/heap.jsonl', lag: '/a/lag.jsonl' })).toEqual({
      [HEAP_VARIABLE]: '/a/heap.jsonl',
      [LAG_VARIABLE]: '/a/lag.jsonl',
    });
  });

  test('a build that is off sets nothing', () => {
    expect(sessionEnv({ lag: '/a/lag.jsonl' })).toEqual({ [LAG_VARIABLE]: '/a/lag.jsonl' });
    expect(sessionEnv({})).toEqual({});
  });
});
