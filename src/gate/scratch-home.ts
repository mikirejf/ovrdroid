import { constants, copyFileSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';

import { backupPath, INSTALLED_DROID } from '../paths.ts';

const INSTALLED_UNDER_HOME = path.relative(homedir(), INSTALLED_DROID);

export function fillScratchHome(home: string, binaries: { target: string; stock: string }): void {
  const installed = path.join(home, INSTALLED_UNDER_HOME);
  mkdirSync(path.dirname(installed), { recursive: true });
  copyFileSync(binaries.target, installed, constants.COPYFILE_FICLONE);
  copyFileSync(binaries.stock, backupPath(installed), constants.COPYFILE_FICLONE);
}
