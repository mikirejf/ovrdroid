import { lstatSync, readFileSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';

import { realOrUndefined } from './paths.ts';

export type Zone = 'temp' | 'repo';

const GIT_DIRECTORY = '.git';

export interface Environment {
  cwd: string;
  tempRoots: readonly string[];
  repoRoot: () => string | undefined;
}

export interface PathFacts {
  resolved: string;
  zone: Zone | undefined;
  exists: boolean;
  directory: boolean;
  symlink: boolean;
}

function strictlyInside(target: string, root: string): boolean {
  return target !== root && target.startsWith(root + path.sep);
}

function readTempRoots(): readonly string[] {
  const candidates = ['/tmp', Bun.env['TMPDIR']];
  const roots = candidates
    .filter((candidate): candidate is string => typeof candidate === 'string' && candidate !== '')
    .map((candidate) => realOrUndefined(candidate))
    .filter((root): root is string => root !== undefined);

  return [...new Set(roots)];
}

function isGitDirectory(marker: string): boolean {
  return (
    statSync(path.join(marker, 'HEAD'), { throwIfNoEntry: false })?.isFile() === true &&
    statSync(path.join(marker, 'objects'), { throwIfNoEntry: false })?.isDirectory() === true &&
    statSync(path.join(marker, 'refs'), { throwIfNoEntry: false })?.isDirectory() === true
  );
}

function isGitLink(marker: string): boolean {
  try {
    return readFileSync(marker, 'utf-8').startsWith('gitdir:');
  } catch {
    return false;
  }
}

function marksRepository(marker: string): boolean {
  const stats = statSync(marker, { throwIfNoEntry: false });
  if (stats === undefined) {
    return false;
  }
  return stats.isDirectory() ? isGitDirectory(marker) : isGitLink(marker);
}

function climbToGit(from: string): string | undefined {
  let current = from;
  for (;;) {
    if (marksRepository(path.join(current, GIT_DIRECTORY))) {
      return current;
    }

    const parent = path.dirname(current);
    if (parent === current) {
      return undefined;
    }
    current = parent;
  }
}

function readRepoRoot(cwd: string): string | undefined {
  const start = realOrUndefined(cwd);
  if (start === undefined) {
    return undefined;
  }

  const root = climbToGit(start);
  if (root === undefined || root === path.parse(root).root) {
    return undefined;
  }

  const home = realOrUndefined(homedir());
  if (home === undefined || home === root || strictlyInside(home, root)) {
    return undefined;
  }

  return root;
}

function once<T>(produce: () => T): () => T {
  let cached: { value: T } | undefined;
  return () => {
    cached ??= { value: produce() };
    return cached.value;
  };
}

export function readEnvironment(cwd: string): Environment {
  return { cwd, tempRoots: readTempRoots(), repoRoot: once(() => readRepoRoot(cwd)) };
}

function zoneOf(resolved: string, environment: Environment): Zone | undefined {
  if (environment.tempRoots.some((root) => strictlyInside(resolved, root))) {
    return 'temp';
  }

  const repoRoot = environment.repoRoot();
  if (repoRoot === undefined || !strictlyInside(resolved, repoRoot)) {
    return undefined;
  }

  const segments = path.relative(repoRoot, resolved).split(path.sep);
  const hidesGit = segments.some((segment) => segment.toLowerCase() === GIT_DIRECTORY);
  return hidesGit ? undefined : 'repo';
}

export function inspect(token: string, environment: Environment): PathFacts {
  const absolute = path.resolve(environment.cwd, token);
  const parent = path.dirname(absolute);
  const resolved = path.join(realOrUndefined(parent) ?? parent, path.basename(absolute));

  let exists = false;
  let directory = false;
  let symlink = false;
  try {
    const stats = lstatSync(resolved);
    directory = stats.isDirectory();
    symlink = stats.isSymbolicLink();
    exists = true;
  } catch {
    exists = false;
  }

  return { resolved, zone: zoneOf(resolved, environment), exists, directory, symlink };
}
