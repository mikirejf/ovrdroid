import { homedir } from 'node:os';
import path from 'node:path';

export const INSTALLED_DROID = path.join(homedir(), '.local', 'bin', 'droid');

export function backupPath(target: string): string {
  return `${target}.orig`;
}
