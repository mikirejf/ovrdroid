import { existsSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

import { hasErrorCode } from '../cli.ts';
import type { FixOutcome, PackageCopy, PackageSpec, Rewriter } from './fix.ts';
import { pinnedCopy, resolveBinPath, rewriteWrappers, wantsLatest } from './fix.ts';
import { readManifest } from './read.ts';

export interface ProjectRoot {
  root: string;
  inGit: boolean;
}

export function findProjectRoot(dir: string): ProjectRoot {
  const result = Bun.spawnSync(['git', '-C', dir, 'rev-parse', '--show-toplevel'], {
    stdout: 'pipe',
    stderr: 'ignore',
  });
  const top = result.stdout.toString().trim();
  return result.exitCode === 0 && top !== ''
    ? { root: top, inGit: true }
    : { root: path.resolve(dir), inGit: false };
}

export interface ProjectMcp extends ProjectRoot {
  file: string;
}

export function findProjectMcp(dir: string, userMcp: string): ProjectMcp | undefined {
  const found = findProjectRoot(dir);
  const file = path.join(found.root, '.factory', 'mcp.json');
  if (path.resolve(file) === path.resolve(userMcp) || !existsSync(file)) {
    return undefined;
  }
  return { ...found, file };
}

function stringsOf(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : [];
}

function packagesOf(value: unknown): string[] {
  if (Array.isArray(value)) {
    return stringsOf(value);
  }
  if (typeof value === 'object' && value !== null && 'packages' in value) {
    return stringsOf(value.packages);
  }
  return [];
}

function packageJsonWorkspaces(root: string): string[] {
  try {
    return packagesOf(readManifest(path.join(root, 'package.json')).workspaces);
  } catch {
    return [];
  }
}

function pnpmWorkspaces(root: string): string[] {
  try {
    return packagesOf(
      Bun.YAML.parse(readFileSync(path.join(root, 'pnpm-workspace.yaml'), 'utf-8')),
    );
  } catch {
    return [];
  }
}

function globOf(pattern: string): Bun.Glob {
  return new Bun.Glob(pattern.replace(/^\.\//u, '').replace(/\/+$/u, ''));
}

export function workspaceDirs(root: string): string[] {
  const patterns = [...packageJsonWorkspaces(root), ...pnpmWorkspaces(root)];
  const excluded = patterns
    .filter((pattern) => pattern.startsWith('!'))
    .map((pattern) => globOf(pattern.slice(1)));
  const found = new Set<string>();
  for (const pattern of patterns.filter((item) => !item.startsWith('!'))) {
    for (const match of globOf(pattern).scanSync({ cwd: root, onlyFiles: false })) {
      const dir = path.join(root, match);
      if (
        !excluded.some((glob) => glob.match(match)) &&
        statSync(dir, { throwIfNoEntry: false })?.isDirectory() === true
      ) {
        found.add(dir);
      }
    }
  }
  return [...found].toSorted();
}

export interface ProjectPackages {
  root: string;
  dirs: readonly string[];
}

export function projectPackages(root: string): ProjectPackages {
  return { root, dirs: [root, ...workspaceDirs(root)] };
}

function installedCopies(dirs: readonly string[], name: string): PackageCopy[] {
  const copies: PackageCopy[] = [];
  for (const candidate of dirs) {
    const dir = path.join(candidate, 'node_modules', name);
    try {
      copies.push({ dir, manifest: readManifest(path.join(dir, 'package.json')) });
    } catch (error) {
      if (!hasErrorCode(error, 'ENOENT')) {
        throw error;
      }
    }
  }
  return copies;
}

export function findInProject(packages: ProjectPackages, spec: PackageSpec): PackageCopy {
  const { root, dirs } = packages;
  const copies = installedCopies(dirs, spec.name);
  const [first] = copies;
  if (first === undefined) {
    throw new Error(
      `${spec.name} is not a dependency of ${root}; add it as a devDependency, then rerun ovrdroid doctor --fix`,
    );
  }
  return wantsLatest(spec) ? first : pinnedCopy(copies, spec, root);
}

const PORTABLE_SCRIPT = 'bin=$1; shift; exec node "$(git rev-parse --show-toplevel)/$bin" "$@"';

function portableArgs(server: string, relative: string, passthrough: readonly string[]): string[] {
  return ['-c', PORTABLE_SCRIPT, server, relative, ...passthrough];
}

function runFromProject(root: string): Rewriter {
  const packages = projectPackages(root);
  return ({ server, invocation, spec }) => {
    const bin = resolveBinPath(findInProject(packages, spec), spec.name);
    return {
      command: 'sh',
      args: portableArgs(server, path.relative(root, bin), invocation.passthrough),
    };
  };
}

function isCommittedAsIs(root: string, file: string): boolean {
  const status = Bun.spawnSync(
    ['git', '-C', root, 'status', '--porcelain', '--ignored', '--', file],
    { stdout: 'pipe', stderr: 'ignore' },
  );
  return status.exitCode === 0 && status.stdout.toString().trim() === '';
}

export function applyProjectFix(project: ProjectMcp): FixOutcome {
  if (!project.inGit) {
    throw new Error(
      `cannot fix ${project.file}: ${project.root} is not a git repository; the portable command finds the project through git`,
    );
  }
  return rewriteWrappers(
    project.file,
    runFromProject(project.root),
    (target) => !isCommittedAsIs(project.root, target),
  );
}
