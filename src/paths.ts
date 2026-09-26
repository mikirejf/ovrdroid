import { realpathSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';

export const INSTALLED_DROID = path.join(homedir(), '.local', 'bin', 'droid');

export const OVRDROID_UNDER_HOME = '.factory/ovrdroid';

const FACTORY = path.join(homedir(), '.factory');

const OVRDROID = path.join(homedir(), ...OVRDROID_UNDER_HOME.split('/'));

export const FACTORY_HOOKS = path.join(FACTORY, 'hooks');

export const FACTORY_SOUNDS = path.join(FACTORY, 'sounds');

export const FACTORY_SETTINGS = path.join(FACTORY, 'settings.json');

export const FACTORY_MCP = path.join(FACTORY, 'mcp.json');

export const FACTORY_LOGS = path.join(FACTORY, 'logs');

export const FACTORY_SESSIONS = path.join(FACTORY, 'sessions');

export const OVRDROID_LOGS = path.join(OVRDROID, 'logs');

export function ovrdroidFile(name: string): string {
  return path.join(OVRDROID, name);
}

export const NPM_NPX_ROOT = path.join(homedir(), '.npm', '_npx');

export const CONFIG_FILES: readonly string[] = [FACTORY_SETTINGS, FACTORY_MCP];

export function cacheDir(...parts: readonly string[]): string {
  return path.join(homedir(), '.cache', 'ovrdroid', ...parts);
}

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
