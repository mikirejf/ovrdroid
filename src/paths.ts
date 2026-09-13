import { realpathSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';

export const INSTALLED_DROID = path.join(homedir(), '.local', 'bin', 'droid');

const FACTORY = path.join(homedir(), '.factory');

export const FACTORY_HOOKS = path.join(FACTORY, 'hooks');

export const FACTORY_SOUNDS = path.join(FACTORY, 'sounds');

export const FACTORY_SETTINGS = path.join(FACTORY, 'settings.json');

export function backupPath(target: string): string {
  return `${target}.orig`;
}

export function realOrUndefined(candidate: string): string | undefined {
  try {
    return realpathSync(candidate);
  } catch {
    return undefined;
  }
}
