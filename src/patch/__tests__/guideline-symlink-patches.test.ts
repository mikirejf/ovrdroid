import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import * as fs from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { guidelineSymlinkPatches, PERSONAL_FOLDER_CHECK } from '../guideline-symlink-patches.ts';
import { describeStrayNames, patchNamed, payloadFunction } from './payload.ts';
import { shipped } from './stock-scanner.ts';

const SYNC = patchNamed(guidelineSymlinkPatches, 'guideline-follow-personal-symlink-sync');
const READ = patchNamed(guidelineSymlinkPatches, 'guideline-follow-personal-symlink-read');

describeStrayNames(guidelineSymlinkPatches);

type Context = [
  typeof fs,
  typeof path,
  () => string[],
  () => string,
  (inner: string, outer: string) => boolean,
  (error: unknown, operation: string) => void,
];

function contained(inner: string, outer: string): boolean {
  const relative = path.relative(outer, inner);
  return relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative);
}

const NAMES = ['r', 'a', 'Ite', 'L', 'N', 'l'];

const syncCheck = payloadFunction<Context, (file: string, dir: string) => string | undefined>(
  NAMES,
  `${SYNC.replace}return F`,
);

const readCheck = payloadFunction<
  Context,
  (file: string, dir: string) => Promise<string | undefined>
>(NAMES, `${PERSONAL_FOLDER_CHECK}${READ.replace}return T`);

let scratch = '';
let home = '';
let outside = '';

function write(file: string, text: string): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
}

function link(target: string, file: string): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.symlinkSync(target, file);
}

function context(): Context {
  return [fs, path, () => ['.factory', '.agents', '.agent'], () => home, contained, () => {}];
}

function sync(file: string): string | undefined {
  return syncCheck(...context())(file, fs.realpathSync(path.dirname(file)));
}

async function read(file: string): Promise<string | undefined> {
  return await readCheck(...context())(file, path.dirname(file));
}

beforeAll(() => {
  scratch = fs.realpathSync(fs.mkdtempSync(path.join(tmpdir(), 'guideline-symlink-')));
  home = path.join(scratch, 'home');
  outside = path.join(scratch, 'outside');
  write(path.join(outside, 'secret.md'), 'SECRET');
  write(path.join(home, 'dotfiles', 'AGENTS.md'), 'DOTFILES');
  link(path.join(home, 'dotfiles', 'AGENTS.md'), path.join(home, '.agents', 'AGENTS.md'));
  link(path.join(outside, 'secret.md'), path.join(home, '.factory', 'AGENTS.md'));
  fs.mkdirSync(path.join(outside, 'folder'));
  link(path.join(outside, 'folder'), path.join(home, '.agent', 'AGENTS.md'));
  write(path.join(home, '.factory', 'CLAUDE.md'), 'PLAIN');
  link(path.join(outside, 'secret.md'), path.join(home, 'repo', 'AGENTS.md'));
  write(path.join(home, 'repo', 'CLAUDE.md'), 'PROJECT');
  link(path.join(outside, 'secret.md'), path.join(home, '.agents-clone', 'AGENTS.md'));
  link(path.join(outside, 'secret.md'), path.join(outside, '.agents', 'AGENTS.md'));
  link(path.join(home, 'repo', 'CLAUDE.md'), path.join(home, 'repo', 'pkg', 'AGENTS.md'));
});

afterAll(() => {
  fs.rmSync(scratch, { recursive: true, force: true });
});

const cases = [
  ['sync', sync],
  ['read', read],
] as const;

describe.each(cases)('the %s check', (_label, check) => {
  test('follows a symlink in a personal folder to its real file', async () => {
    const file = path.join(home, '.agents', 'AGENTS.md');
    expect(await check(file)).toBe(path.join(home, 'dotfiles', 'AGENTS.md'));
  });

  test('follows a personal symlink even when it points outside the folder', async () => {
    const file = path.join(home, '.factory', 'AGENTS.md');
    expect(await check(file)).toBe(path.join(outside, 'secret.md'));
  });

  test('still loads a plain file in a personal folder', async () => {
    const file = path.join(home, '.factory', 'CLAUDE.md');
    expect(await check(file)).toBe(path.join(home, '.factory', 'CLAUDE.md'));
  });

  test('rejects a personal symlink that points at a folder', async () => {
    expect(await check(path.join(home, '.agent', 'AGENTS.md'))).toBeUndefined();
  });

  test('rejects a project symlink that points outside the project', async () => {
    expect(await check(path.join(home, 'repo', 'AGENTS.md'))).toBeUndefined();
  });

  test('rejects a project symlink even when it points at a file in the project', async () => {
    expect(await check(path.join(home, 'repo', 'pkg', 'AGENTS.md'))).toBeUndefined();
  });

  test('still loads a plain file in a project', async () => {
    const file = path.join(home, 'repo', 'CLAUDE.md');
    expect(await check(file)).toBe(file);
  });

  test('rejects a symlink in a folder whose name only looks like a personal one', async () => {
    expect(await check(path.join(home, '.agents-clone', 'AGENTS.md'))).toBeUndefined();
  });

  test('rejects a symlink in a personal folder name that is not under the home folder', async () => {
    expect(await check(path.join(outside, '.agents', 'AGENTS.md'))).toBeUndefined();
  });
});

describe('the stock source', () => {
  const { patchedText } = shipped(guidelineSymlinkPatches);

  test.skipIf(patchedText === '')('carries both patches after the build', () => {
    expect(patchedText).toContain('function $ODpersonal');
  });
});
