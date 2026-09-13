import { afterAll, describe, expect, test } from 'bun:test';
import { mkdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import type { Environment } from '../src/rm-facts.ts';
import { inspect, readEnvironment } from '../src/rm-facts.ts';
import { makeTempDir } from '../src/temp.ts';

const base = makeTempDir('facts');
const repo = path.join(base, 'repo');
const outside = path.join(base, 'outside');

mkdirSync(repo);
mkdirSync(outside);
mkdirSync(path.join(repo, 'src'));
writeFileSync(path.join(repo, 'src', 'a.ts'), '');
writeFileSync(path.join(outside, 'b.ts'), '');
symlinkSync(outside, path.join(repo, 'link'));
function git(...args: readonly string[]): void {
  Bun.spawnSync(['git', '-C', repo, ...args], { stdout: 'ignore', stderr: 'ignore' });
}

Bun.spawnSync(['git', 'init', '--quiet', repo], { stdout: 'ignore', stderr: 'ignore' });
git('-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '--allow-empty', '-qm', 'init');

afterAll(() => {
  rmSync(base, { recursive: true, force: true });
});

const real = readEnvironment(base);
const repoOnly: Environment = { cwd: repo, tempRoots: [], repoRoot: () => repo };

function repoRootUnder(home: string, cwd: string): string {
  const module = path.join(import.meta.dir, '..', 'src', 'rm-facts.ts');
  const script = `import {readEnvironment} from ${JSON.stringify(module)};
console.log(String(readEnvironment(${JSON.stringify(cwd)}).repoRoot()));`;
  const result = Bun.spawnSync(['bun', '-e', script], {
    env: { ...Bun.env, HOME: home },
    stdout: 'pipe',
    stderr: 'pipe',
  });

  return result.stdout.toString().trim();
}

describe('inspect', () => {
  test('marks a file under a temp root as temp', () => {
    expect(inspect(path.join(base, 'anything'), real).zone).toBe('temp');
  });

  test('leaves the temp root itself unzoned', () => {
    const root = real.tempRoots[0] ?? '';
    expect(inspect(root, real).zone).toBeUndefined();
  });

  test('marks a file inside the repository as repo', () => {
    const facts = inspect(path.join(repo, 'src', 'a.ts'), repoOnly);

    expect(facts.zone).toBe('repo');
    expect(facts.exists).toBe(true);
    expect(facts.directory).toBe(false);
    expect(facts.symlink).toBe(false);
  });

  test('reports a directory', () => {
    expect(inspect('src', repoOnly).directory).toBe(true);
  });

  test('leaves the repository root itself unzoned', () => {
    expect(inspect(repo, repoOnly).zone).toBeUndefined();
  });

  test('leaves anything under .git unzoned', () => {
    expect(inspect(path.join(repo, '.git', 'config'), repoOnly).zone).toBeUndefined();
  });

  test.each(['.GIT', '.Git', '.gIt'])('leaves the case variant %s unzoned', (segment) => {
    expect(inspect(path.join(repo, segment), repoOnly).zone).toBeUndefined();
    expect(inspect(path.join(repo, segment, 'config'), repoOnly).zone).toBeUndefined();
  });

  test('leaves a path outside both zones unzoned', () => {
    expect(inspect(path.join(outside, 'b.ts'), repoOnly).zone).toBeUndefined();
  });

  test('does not trust a symlinked parent that points out of the zone', () => {
    const facts = inspect(path.join(repo, 'link', 'b.ts'), repoOnly);

    expect(facts.resolved).toBe(path.join(outside, 'b.ts'));
    expect(facts.zone).toBeUndefined();
  });

  test('flags a symlink itself', () => {
    expect(inspect(path.join(repo, 'link'), repoOnly).symlink).toBe(true);
  });

  test('flags a symlink whose token carries a trailing slash', () => {
    expect(inspect(`${path.join(repo, 'link')}/`, repoOnly).symlink).toBe(true);
  });

  test('flags a symlink that lives in the temp zone', () => {
    const link = path.join(base, 'temp-link');
    symlinkSync(outside, link);

    expect(inspect(link, real)).toMatchObject({ zone: 'temp', symlink: true });
  });

  test('reports a missing path', () => {
    expect(inspect(path.join(repo, 'nope'), repoOnly)).toMatchObject({
      exists: false,
      directory: false,
      symlink: false,
    });
  });
});

describe('readEnvironment', () => {
  test('discovers the repository root', () => {
    expect(readEnvironment(path.join(repo, 'src')).repoRoot()).toBe(repo);
  });

  test('memoizes the repository root lookup', () => {
    const environment = readEnvironment(path.join(repo, 'src'));

    expect(environment.repoRoot()).toBe(environment.repoRoot());
  });

  test('refuses a repository root that is the home directory', () => {
    expect(repoRootUnder(repo, path.join(repo, 'src'))).toBe('undefined');
  });

  test('refuses any repository root when the home directory cannot be resolved', () => {
    expect(repoRootUnder(path.join(base, 'definitely-missing'), path.join(repo, 'src'))).toBe(
      'undefined',
    );
  });

  test('refuses a bare .git directory that holds no repository', () => {
    const fake = path.join(base, 'fake-marker');
    mkdirSync(path.join(fake, '.git'), { recursive: true });

    expect(readEnvironment(fake).repoRoot()).toBeUndefined();
  });

  test('refuses a .git directory missing any one of HEAD, objects and refs', () => {
    const partial = path.join(base, 'partial-marker', '.git');
    mkdirSync(path.join(partial, 'objects'), { recursive: true });
    mkdirSync(path.join(partial, 'refs'), { recursive: true });

    expect(readEnvironment(path.dirname(partial)).repoRoot()).toBeUndefined();
  });

  test('refuses a .git file that is not a gitdir link', () => {
    const stray = path.join(base, 'stray-marker');
    mkdirSync(stray, { recursive: true });
    writeFileSync(path.join(stray, '.git'), 'notes to self\n');

    expect(readEnvironment(stray).repoRoot()).toBeUndefined();
  });

  test('accepts a linked worktree whose .git is a gitdir file', () => {
    const linked = path.join(base, 'linked-worktree');
    git('worktree', 'add', '--detach', linked);

    expect(readEnvironment(linked).repoRoot()).toBe(linked);
  });

  test('finds the real temp roots', () => {
    expect(real.tempRoots.length).toBeGreaterThan(0);
    expect(real.tempRoots.some((root) => base.startsWith(root + path.sep))).toBe(true);
  });
});
