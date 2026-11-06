import { describe, expect, test } from 'bun:test';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';

import { patchSource } from '../../binary/apply.ts';
import { joinApp } from '../../binary/graph.ts';
import { withTempDir } from '../../temp.ts';
import { shieldPatches } from '../shield-patches.ts';
import { failureOf, payloadFunction } from './payload.ts';
import { stockDroid } from './stock-scanner.ts';

type Run = (request: { args: string[]; cwd: string }) => Promise<string>;
type Identity = (cwd: string, paths: string[] | undefined, run: Run) => Promise<string>;

const IDENTITY_FUNCTION =
  /async function [\w$]+\([\w$]+,[\w$]+,[\w$]+\)\{return await [\w$]+\(\{args:[^}]*?cwd:[\w$]+\}\)\}/gu;

function identityIn(text: string, marker: string): Identity {
  const found = (text.match(IDENTITY_FUNCTION) ?? []).filter((source) => source.includes(marker));
  if (found.length !== 1) {
    throw new Error(`expected one index identity function with ${marker}, found ${found.length}`);
  }
  return payloadFunction<[], Identity>([], `return ${found[0]}`)();
}

async function git(cwd: string, args: readonly string[]): Promise<{ code: number; out: string }> {
  const child = Bun.spawn(
    ['git', '-c', 'user.name=probe', '-c', 'user.email=probe@example.invalid', ...args],
    { cwd, stdout: 'pipe', stderr: 'pipe', env: { ...Bun.env, GIT_CONFIG_GLOBAL: '/dev/null' } },
  );
  const [out] = await Promise.all([new Response(child.stdout).text(), child.exited]);
  return { code: child.exitCode ?? -1, out };
}

async function run({ args, cwd }: { args: string[]; cwd: string }): Promise<string> {
  const { code, out } = await git(cwd, args);
  if (code !== 0) {
    throw new Error(`git ${args.join(' ')} exited ${code}`);
  }
  return out;
}

function recording(seen: string[][]): Run {
  return async ({ args }) => {
    seen.push(args);
    return await Promise.resolve('');
  };
}

async function argsAsked(identity: Identity, paths?: string[]): Promise<string[][]> {
  const seen: string[][] = [];
  await identity('/repo', paths, recording(seen));
  return seen;
}

async function commitFile(dir: string, name: string, content: string): Promise<void> {
  await writeFile(path.join(dir, name), content);
  await run({ args: ['add', name], cwd: dir });
  await run({ args: ['commit', '--quiet', '-m', name], cwd: dir });
}

async function withConflictedRepo(use: (dir: string) => Promise<void>): Promise<void> {
  await withTempDir('shield-index', async (dir) => {
    await run({ args: ['init', '--quiet', '-b', 'main'], cwd: dir });
    await commitFile(dir, 'clash.txt', 'base\n');
    await run({ args: ['checkout', '--quiet', '-b', 'side'], cwd: dir });
    await commitFile(dir, 'clash.txt', 'side\n');
    await run({ args: ['checkout', '--quiet', 'main'], cwd: dir });
    await commitFile(dir, 'clash.txt', 'main\n');
    const merge = await git(dir, ['merge', 'side']);
    expect(merge.code).toBe(1);
    await writeFile(path.join(dir, 'staged.txt'), 'one\n');
    await run({ args: ['add', 'staged.txt'], cwd: dir });
    await writeFile(path.join(dir, 'other.txt'), 'one\n');
    await run({ args: ['add', 'other.txt'], cwd: dir });
    await use(dir);
  });
}

const stock = stockDroid;

if (stock !== undefined) {
  const stockIdentity = identityIn(joinApp(stock), '"write-tree"');
  const patchedIdentity = identityIn(joinApp(patchSource(stock, shieldPatches)), '"ls-files"');

  describe('the staged-index identity Droid-Shield re-checks a scan against', () => {
    test('stock cannot fingerprint the whole index while a merge conflict is unresolved', async () => {
      await withConflictedRepo(async (dir) => {
        expect(await failureOf(stockIdentity(dir, undefined, run))).toContain(
          'write-tree exited 128',
        );
      });
    });

    test('the patched identity still fingerprints the whole index mid-conflict', async () => {
      await withConflictedRepo(async (dir) => {
        expect(await patchedIdentity(dir, undefined, run)).toContain('staged.txt');
        expect(await patchedIdentity(dir, ['staged.txt'], run)).toContain('staged.txt');
      });
    });

    test('the whole-index identity is equal when nothing changed and differs when a blob does', async () => {
      await withConflictedRepo(async (dir) => {
        const before = await patchedIdentity(dir, undefined, run);
        expect(await patchedIdentity(dir, undefined, run)).toBe(before);
        await writeFile(path.join(dir, 'staged.txt'), 'two\n');
        await run({ args: ['add', 'staged.txt'], cwd: dir });
        expect(await patchedIdentity(dir, undefined, run)).not.toBe(before);
      });
    });

    test('the whole-index identity sees a resolved conflict entry change', async () => {
      await withConflictedRepo(async (dir) => {
        const before = await patchedIdentity(dir, undefined, run);
        await writeFile(path.join(dir, 'clash.txt'), 'resolved\n');
        await run({ args: ['add', 'clash.txt'], cwd: dir });
        expect(await patchedIdentity(dir, undefined, run)).not.toBe(before);
      });
    });

    test('a paths identity follows its own paths and ignores the rest of the index', async () => {
      await withConflictedRepo(async (dir) => {
        const before = await patchedIdentity(dir, ['staged.txt'], run);
        expect(await patchedIdentity(dir, ['staged.txt'], run)).toBe(before);
        await writeFile(path.join(dir, 'other.txt'), 'two\n');
        await run({ args: ['add', 'other.txt'], cwd: dir });
        expect(await patchedIdentity(dir, ['staged.txt'], run)).toBe(before);
        await writeFile(path.join(dir, 'staged.txt'), 'two\n');
        await run({ args: ['add', 'staged.txt'], cwd: dir });
        expect(await patchedIdentity(dir, ['staged.txt'], run)).not.toBe(before);
      });
    });

    test('with paths the patched identity runs the same git command as stock', async () => {
      const paths = ['a b', 'c'];
      const patched = await argsAsked(patchedIdentity, paths);
      expect(patched).toEqual(await argsAsked(stockIdentity, paths));
      expect(patched).toEqual([['ls-files', '--stage', '-z', '--', 'a b', 'c']]);
    });

    test('without paths the patched identity lists the index like the paths branch does', async () => {
      expect(await argsAsked(patchedIdentity)).toEqual([['ls-files', '--stage', '-z']]);
    });
  });
}
