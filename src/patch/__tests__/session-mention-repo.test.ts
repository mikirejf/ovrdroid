import { describe, expect, test } from 'bun:test';
import fs from 'node:fs';

import { SHORT_PATH_CHARS } from '../session-mention-patches.ts';
import { disk, DIR, HOME, repoPicker } from './session-mention-disk.ts';
import type { Entries } from './session-mention-disk.ts';
import type { Tree } from './session-mention-harness.ts';
import { pickerReading, session } from './session-mention-harness.ts';

function repoOf(entries: Entries, cwd: string | undefined): string {
  return repoPicker(entries).$ODsessionPlace(cwd).label;
}

function rootOf(entries: Entries, cwd: string): boolean {
  return repoPicker(entries).$ODsessionPlace(cwd).root;
}

const CHECKOUT = {
  '/home/me/dev/proj/.git': DIR,
  '/home/me/dev/proj/src/deep': DIR,
} satisfies Entries;

describe('the repo label is the name of the git folder around the session cwd', () => {
  test('a folder with a .git directory is named after itself', () => {
    expect(repoOf(CHECKOUT, '/home/me/dev/proj')).toBe('proj');
  });

  test('a subfolder walks up to the repo', () => {
    expect(repoOf(CHECKOUT, '/home/me/dev/proj/src/deep')).toBe('proj');
  });

  test('the nearest .git wins over one further up', () => {
    const nested = { ...CHECKOUT, '/home/me/dev/proj/vendor/lib/.git': DIR };
    expect(repoOf(nested, '/home/me/dev/proj/vendor/lib')).toBe('lib');
  });

  test('a worktree .git file names the main repo, not the worktree folder', () => {
    const worktree = {
      '/home/me/dev/proj-fix/.git': 'gitdir: /home/me/dev/proj/.git/worktrees/proj-fix\n',
    };
    expect(repoOf(worktree, '/home/me/dev/proj-fix')).toBe('proj');
  });

  test('a relative gitdir is read from the worktree folder', () => {
    const worktree = {
      '/home/me/dev/wt/.git': 'gitdir: ../main/.git/worktrees/wt\r\n',
      '/home/me/dev/main/.git/worktrees/wt': DIR,
    };
    expect(repoOf(worktree, '/home/me/dev/wt')).toBe('main');
  });

  test.each([
    ['a submodule gitdir', 'gitdir: /home/me/dev/super/.git/modules/sub\n'],
    ['a worktrees folder outside a .git folder', 'gitdir: /home/me/dev/main/worktrees/sub\n'],
    ['a gitdir too short to hold a repo', 'gitdir: /worktrees/sub\n'],
    ['no gitdir line', 'something else\n'],
    ['an empty file', ''],
  ])('%s uses the folder name', (_case, content) => {
    expect(repoOf({ '/home/me/dev/sub/.git': content }, '/home/me/dev/sub')).toBe('sub');
  });
});

describe('without a repo the label is a shortened path', () => {
  const PLAIN = {
    '/home/me/dev-work/arx1/harvester/scripts': DIR,
    '/home/me/dev/tools': DIR,
    '/srv/data/archive/2026/october/reports': DIR,
  } satisfies Entries;

  test('a path under the home folder starts with ~', () => {
    expect(repoOf(PLAIN, '/home/me/dev/tools')).toBe('~/dev/tools');
  });

  test('the home folder itself is ~', () => {
    expect(repoOf({ '/home/me': DIR }, HOME)).toBe('~');
  });

  test('a long path keeps the first folder after ~ and the last two', () => {
    expect(repoOf(PLAIN, '/home/me/dev-work/arx1/harvester/scripts')).toBe(
      '~/dev-work/\u2026/harvester/scripts',
    );
  });

  test('a long path outside home keeps its first folder and the last two', () => {
    expect(repoOf(PLAIN, '/srv/data/archive/2026/october/reports')).toBe(
      '/srv/\u2026/october/reports',
    );
  });

  test('a folder whose name only starts like the home folder is not shortened to ~', () => {
    expect(repoOf({ '/home/meow/x': DIR }, '/home/meow/x')).toBe('/home/meow/x');
  });

  test(`${SHORT_PATH_CHARS} characters stay whole and one more is cut`, () => {
    const input = repoPicker({});
    const shorten = (cwd: string): string => input.$ODshortPath(cwd);
    const whole = `~/${'a'.repeat(SHORT_PATH_CHARS - 14)}/bb/cc/ddd/e`;
    expect(whole).toHaveLength(SHORT_PATH_CHARS);
    expect(shorten(`${HOME}${whole.slice(1)}`)).toBe(whole);
    const longer = `${HOME}${whole.slice(1)}e`;
    expect(shorten(longer)).toBe(`~/${'a'.repeat(SHORT_PATH_CHARS - 14)}/\u2026/ddd/ee`);
  });

  test('a path with too few folders to cut stays whole however long it is', () => {
    const long = `/home/me/${'a'.repeat(40)}/${'b'.repeat(40)}`;
    expect(repoPicker({}).$ODshortPath(long)).toBe(`~/${'a'.repeat(40)}/${'b'.repeat(40)}`);
  });
});

describe('the place says whether the label alone tells where the session ran', () => {
  test('the root of a checkout is the repo itself', () => {
    expect(rootOf(CHECKOUT, '/home/me/dev/proj')).toBe(true);
  });

  test('a subfolder of a checkout is not', () => {
    expect(rootOf(CHECKOUT, '/home/me/dev/proj/src/deep')).toBe(false);
  });

  test('a worktree is not, even at its own root', () => {
    const worktree = {
      '/home/me/dev/proj-fix/.git': 'gitdir: /home/me/dev/proj/.git/worktrees/proj-fix\n',
    };
    expect(rootOf(worktree, '/home/me/dev/proj-fix')).toBe(false);
  });

  test('a folder outside any repo is, because its label is its path', () => {
    expect(rootOf({ '/home/me/dev/tools': DIR }, '/home/me/dev/tools')).toBe(true);
  });
});

describe('a folder that is gone or not given', () => {
  test('a cwd that no longer exists gets its path, not the repo above it', () => {
    expect(repoOf(CHECKOUT, '/home/me/dev/proj/gone')).toBe('~/dev/proj/gone');
  });

  test('a cwd that is a file gets its path', () => {
    const file = { '/home/me/dev/proj/.git': DIR, '/home/me/dev/proj/notes.txt': 'x' };
    expect(repoOf(file, '/home/me/dev/proj/notes.txt')).toBe('~/dev/proj/notes.txt');
  });

  test('a .git file that cannot be read falls back to the path', () => {
    const { tree } = disk({ '/home/me/dev/bad/.git': 'gitdir: x' });
    const broken: Tree = {
      statSync: tree.statSync,
      readFileSync: () => {
        throw new Error('EACCES');
      },
    };
    expect(pickerReading(fs, broken, HOME).$ODsessionPlace('/home/me/dev/bad').label).toBe(
      '~/dev/bad',
    );
  });

  test.each([undefined, ''])('%j gets no label', (cwd) => {
    expect(repoOf(CHECKOUT, cwd)).toBe('');
  });
});

describe('the label is read once per folder', () => {
  test('a second ask for the same cwd does not touch the disk', () => {
    const input = repoPicker(CHECKOUT);
    expect(input.$ODsessionPlace('/home/me/dev/proj/src/deep').label).toBe('proj');
    const used = input.calls();
    expect(used).toBeGreaterThan(0);
    expect(input.$ODsessionPlace('/home/me/dev/proj/src/deep').label).toBe('proj');
    expect(input.calls()).toBe(used);
  });

  test('a missing folder is remembered too', () => {
    const input = repoPicker(CHECKOUT);
    input.$ODsessionPlace('/home/me/nowhere');
    const used = input.calls();
    expect(input.$ODsessionPlace('/home/me/nowhere').label).toBe('~/nowhere');
    expect(input.calls()).toBe(used);
  });

  test('rows that share a cwd are read once, and a second call reads nothing', () => {
    const rows = [
      { ...session('a', 'A', 1), cwd: '/home/me/dev/proj' },
      { ...session('b', 'B', 2), cwd: '/home/me/dev/proj' },
    ];
    const alone = repoPicker(CHECKOUT);
    alone.$ODsessionItems(rows.slice(0, 1), () => null);
    const input = repoPicker(CHECKOUT);
    input.$ODsessionItems(rows, () => null);
    expect(input.calls()).toBe(alone.calls());
    input.$ODsessionItems(rows, () => null);
    expect(input.calls()).toBe(alone.calls());
  });

  test('only the rows handed over are read', () => {
    const input = repoPicker(CHECKOUT);
    input.$ODsessionItems([{ ...session('a', 'A', 1), cwd: '/home/me/dev/proj' }], () => null);
    const used = input.calls();
    input.$ODsessionPlace('/home/me/dev/proj/src/deep');
    expect(input.calls()).toBeGreaterThan(used);
  });
});
