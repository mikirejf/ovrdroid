import { afterAll, describe, expect, test } from 'bun:test';
import { readFileSync, writeFileSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import path from 'node:path';

import { makeTempDir } from '../../temp.ts';
import { fillScratchHome } from '../scratch-home.ts';

const PATHS_MODULE = path.join(import.meta.dir, '..', '..', 'paths.ts');
const SCRIPT = `import { backupPath, INSTALLED_DROID } from ${JSON.stringify(PATHS_MODULE)};
console.log(INSTALLED_DROID);
console.log(backupPath(INSTALLED_DROID));`;
const dir = makeTempDir('gate-scratch-home');

afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

function pathsUnder(home: string) {
  const run = Bun.spawnSync(['bun', '-e', SCRIPT], { env: { ...Bun.env, HOME: home } });
  const [installed = '', backup = ''] = run.stdout.toString().trim().split('\n');
  return { installed, backup };
}

describe('fillScratchHome', () => {
  test('places the target and the stock where the installed Droid and its .orig resolve under that HOME', () => {
    const target = path.join(dir, 'target');
    const stock = path.join(dir, 'stock');
    const home = path.join(dir, 'home');
    writeFileSync(target, 'patched bytes');
    writeFileSync(stock, 'stock bytes');
    fillScratchHome(home, { target, stock });

    const { installed, backup } = pathsUnder(home);
    expect(installed).toBe(path.join(home, '.local', 'bin', 'droid'));
    expect(backup).toBe(path.join(home, '.local', 'bin', 'droid.orig'));
    expect(readFileSync(installed, 'utf-8')).toBe('patched bytes');
    expect(readFileSync(backup, 'utf-8')).toBe('stock bytes');
  });
});
