import { constants, copyFileSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';

import { backupPath, INSTALLED_DROID } from '../paths.ts';

const INSTALLED_UNDER_HOME = path.relative(homedir(), INSTALLED_DROID);

interface Binaries {
  target: string;
  stock: string;
}

export function fillScratchHome(home: string, binaries: Binaries): Binaries {
  const target = path.join(home, INSTALLED_UNDER_HOME);
  const stock = backupPath(target);
  mkdirSync(path.dirname(target), { recursive: true });
  copyFileSync(binaries.target, target, constants.COPYFILE_FICLONE);
  copyFileSync(binaries.stock, stock, constants.COPYFILE_FICLONE);
  return { target, stock };
}
