import { existsSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

import { HEAP_VARIABLE } from '../patch/heap-patches.ts';
import { LAG_VARIABLE } from '../patch/lag-patches.ts';
import { FACTORY_DROIDS } from '../paths.ts';
import { parseDroidName } from './subagents.ts';

export const DEFAULT_FILE_COUNT = 4;
const DEFAULT_GLOB = 'src/**/*.ts';
const REPO_ROOT = path.resolve(import.meta.dir, '..', '..');

export interface SessionFiles {
  heap?: string | undefined;
  lag?: string | undefined;
}

export function sessionEnv(files: SessionFiles) {
  return {
    ...(files.heap !== undefined && { [HEAP_VARIABLE]: files.heap }),
    ...(files.lag !== undefined && { [LAG_VARIABLE]: files.lag }),
  };
}

export function filesMatching(globs: readonly string[], cwd: string): string[] {
  const found = new Set<string>();
  for (const pattern of globs) {
    for (const file of new Bun.Glob(pattern).scanSync({ cwd, absolute: true, onlyFiles: true })) {
      found.add(file);
    }
  }
  if (found.size === 0) {
    throw new Error(`no file matches ${globs.join(' ')} under ${cwd}`);
  }
  return [...found].toSorted();
}

export function largestOf(files: readonly string[], limit: number): string[] {
  return files
    .map((file) => ({ file, bytes: statSync(file).size }))
    .toSorted((a, b) => b.bytes - a.bytes || a.file.localeCompare(b.file))
    .slice(0, limit)
    .map((entry) => entry.file);
}

export function chooseFiles(globs?: readonly string[]): string[] {
  return globs === undefined
    ? largestOf(filesMatching([DEFAULT_GLOB], REPO_ROOT), DEFAULT_FILE_COUNT)
    : filesMatching(globs, process.cwd());
}

function droidNamesIn(dir: string): string[] {
  const names: string[] = [];
  if (!existsSync(dir)) {
    return names;
  }
  for (const file of new Bun.Glob('*.md').scanSync({ cwd: dir, onlyFiles: true })) {
    const name = parseDroidName(readFileSync(path.join(dir, file), 'utf-8'));
    if (name !== undefined) {
      names.push(name);
    }
  }
  return names;
}

export function offeredTypes(cwd: string): string[] {
  return [...droidNamesIn(FACTORY_DROIDS), ...droidNamesIn(path.join(cwd, '.factory', 'droids'))];
}
