import { describe, expect, test } from 'bun:test';
import {
  chmodSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';

import { makeTempDir } from '../../temp.ts';
import type { McpServerEntry } from '../checks.ts';
import { checkMcpConfig } from '../checks.ts';
import {
  applyProjectFix,
  findInProject,
  findProjectMcp,
  findProjectRoot,
  projectPackages,
  workspaceDirs,
} from '../project.ts';
import { readMcpConfig } from '../read.ts';
import { formatFixed } from '../report.ts';

function gitRepo(): string {
  const root = makeTempDir('project');
  const init = Bun.spawnSync(['git', 'init', '-q', root]);
  expect(init.exitCode).toBe(0);
  return root;
}

function git(root: string, ...args: string[]): void {
  const result = Bun.spawnSync(['git', '-C', root, ...args], { stderr: 'pipe' });
  expect(result.stderr.toString()).toBe('');
  expect(result.exitCode).toBe(0);
}

function commitFile(root: string, file: string): void {
  git(root, 'add', '--', file);
  git(root, 'commit', '-q', '-m', 'mcp', '--', file);
}

function writeJson(file: string, value: unknown): void {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}

interface FakePackage {
  dir: string;
  name: string;
  version: string;
  bin: string;
}

function addPackage(pkg: FakePackage): string {
  const dir = path.join(pkg.dir, 'node_modules', pkg.name);
  writeJson(path.join(dir, 'package.json'), {
    name: pkg.name,
    version: pkg.version,
    bin: pkg.bin,
  });
  const bin = path.join(dir, pkg.bin);
  mkdirSync(path.dirname(bin), { recursive: true });
  writeFileSync(bin, '#!/usr/bin/env node\n');
  return dir;
}

interface ServerWithEnv extends McpServerEntry {
  env?: Record<string, string>;
}

function writeProjectMcp(root: string, servers: Record<string, ServerWithEnv>): string {
  const file = path.join(root, '.factory', 'mcp.json');
  writeJson(file, { mcpServers: servers });
  chmodSync(file, 0o644);
  return file;
}

describe('project root and mcp path', () => {
  test('a subdirectory of a git repo resolves to the repo root', () => {
    const root = gitRepo();
    const sub = path.join(root, 'apps', 'web');
    mkdirSync(sub, { recursive: true });
    expect(findProjectRoot(sub)).toEqual({ root, inGit: true });
  });

  test('outside a git repo the directory itself is the root', () => {
    const dir = makeTempDir('project');
    expect(findProjectRoot(dir)).toEqual({ root: dir, inGit: false });
  });

  test('a missing project file is skipped, and so is the user file', () => {
    const root = gitRepo();
    expect(findProjectMcp(root, '/nowhere/mcp.json')).toBeUndefined();
    const file = writeProjectMcp(root, {});
    const sub = path.join(root, 'sub');
    mkdirSync(sub);
    expect(findProjectMcp(sub, '/nowhere/mcp.json')).toEqual({
      root,
      inGit: true,
      file,
    });
    expect(findProjectMcp(root, file)).toBeUndefined();
  });
});

describe('workspace discovery', () => {
  test('package.json workspaces, array or object form', () => {
    const root = makeTempDir('project');
    mkdirSync(path.join(root, 'packages', 'b'), { recursive: true });
    mkdirSync(path.join(root, 'packages', 'a'), { recursive: true });
    writeFileSync(path.join(root, 'packages', 'not-a-dir'), '');
    writeJson(path.join(root, 'package.json'), { workspaces: ['packages/*'] });
    expect(workspaceDirs(root)).toEqual([
      path.join(root, 'packages', 'a'),
      path.join(root, 'packages', 'b'),
    ]);
    writeJson(path.join(root, 'package.json'), { workspaces: { packages: ['packages/a'] } });
    expect(workspaceDirs(root)).toEqual([path.join(root, 'packages', 'a')]);
  });

  test('pnpm-workspace.yaml packages', () => {
    const root = makeTempDir('project');
    mkdirSync(path.join(root, 'apps', 'jobs'), { recursive: true });
    writeFileSync(path.join(root, 'pnpm-workspace.yaml'), "packages:\n  - 'apps/*'\n");
    expect(workspaceDirs(root)).toEqual([path.join(root, 'apps', 'jobs')]);
  });

  test('a negated pattern removes the directories it matches', () => {
    const root = makeTempDir('project');
    mkdirSync(path.join(root, 'packages', 'keep'), { recursive: true });
    mkdirSync(path.join(root, 'packages', 'excluded'), { recursive: true });
    writeFileSync(
      path.join(root, 'pnpm-workspace.yaml'),
      "packages:\n  - 'packages/*'\n  - '!packages/excluded/'\n",
    );
    expect(workspaceDirs(root)).toEqual([path.join(root, 'packages', 'keep')]);
  });
});

describe('findInProject', () => {
  test('the root copy wins, a pinned version picks its match', () => {
    const root = makeTempDir('project');
    mkdirSync(path.join(root, 'apps', 'jobs'), { recursive: true });
    writeJson(path.join(root, 'package.json'), { workspaces: ['apps/*'] });
    const top = addPackage({ dir: root, name: 'srv', version: '1.0.0', bin: 'bin.js' });
    const nested = addPackage({
      dir: path.join(root, 'apps', 'jobs'),
      name: 'srv',
      version: '2.0.0',
      bin: 'bin.js',
    });
    const packages = projectPackages(root);
    expect(findInProject(packages, { name: 'srv', version: '' }).dir).toBe(top);
    expect(findInProject(packages, { name: 'srv', version: 'latest' }).dir).toBe(top);
    expect(findInProject(packages, { name: 'srv', version: '2.0.0' }).dir).toBe(nested);
    expect(() => findInProject(packages, { name: 'srv', version: '3.0.0' })).toThrow(
      'srv@3.0.0 is not installed',
    );
  });
});

describe('applyProjectFix rewrites wrappers to the project copy', () => {
  test('a pnpm-style symlinked package keeps its non-realpath path', () => {
    const root = gitRepo();
    const jobs = path.join(root, 'apps', 'jobs');
    writeFileSync(path.join(root, 'pnpm-workspace.yaml'), 'packages:\n  - apps/*\n');
    const store = path.join(root, 'node_modules', '.pnpm', 'trigger.dev@4.5.8_hash');
    addPackage({ dir: store, name: 'trigger.dev', version: '4.5.8', bin: 'dist/esm/index.js' });
    mkdirSync(path.join(jobs, 'node_modules'), { recursive: true });
    symlinkSync(
      path.join(store, 'node_modules', 'trigger.dev'),
      path.join(jobs, 'node_modules', 'trigger.dev'),
    );
    const file = writeProjectMcp(root, {
      trigger: { command: 'npx', args: ['trigger.dev@4.5.8', 'mcp', '--dev-only'], env: {} },
      pinned: { command: 'node', args: ['/x.js'] },
      off: { command: 'npx', args: ['-y', 'absent'], disabled: true },
    });
    commitFile(root, file);
    const { mode } = statSync(file);
    const outcome = applyProjectFix({ root, inGit: true, file });
    expect(outcome.backup).toBeUndefined();
    expect(() => statSync(`${file}.bak`)).toThrow();
    const written: unknown = JSON.parse(readFileSync(file, 'utf-8'));
    expect(written).toEqual({
      mcpServers: {
        trigger: {
          command: 'sh',
          args: [
            '-c',
            'bin=$1; shift; exec node "$(git rev-parse --show-toplevel)/$bin" "$@"',
            'trigger',
            'apps/jobs/node_modules/trigger.dev/dist/esm/index.js',
            'mcp',
            '--dev-only',
          ],
          env: {},
        },
        pinned: { command: 'node', args: ['/x.js'] },
        off: { command: 'npx', args: ['-y', 'absent'], disabled: true },
      },
    });
    expect(Object.keys(readMcpConfig(file).mcpServers)).toEqual(['trigger', 'pinned', 'off']);
    expect(checkMcpConfig(written, 'user')).toHaveLength(0);
    expect(statSync(file).mode).toBe(mode);
  });

  test('the backup is skipped only when git holds the current bytes', () => {
    const root = gitRepo();
    addPackage({ dir: root, name: 'srv', version: '1.0.0', bin: 'bin.js' });
    const wrapped = { srv: { command: 'npx', args: ['srv'] } };
    const file = writeProjectMcp(root, wrapped);

    const untracked = applyProjectFix({ root, inGit: true, file });
    expect(untracked.backup).toBe(`${file}.bak`);
    expect(statSync(`${file}.bak`).isFile()).toBe(true);
    rmSync(`${file}.bak`);

    writeProjectMcp(root, wrapped);
    commitFile(root, file);
    writeProjectMcp(root, { ...wrapped, other: { command: 'node', args: ['/x.js'] } });
    const edited = applyProjectFix({ root, inGit: true, file });
    expect(edited.backup).toBe(`${file}.bak`);
    expect(statSync(`${file}.bak`).isFile()).toBe(true);
    rmSync(`${file}.bak`);

    writeProjectMcp(root, { ...wrapped, pinned: { command: 'node', args: ['/y.js'] } });
    commitFile(root, file);
    const clean = applyProjectFix({ root, inGit: true, file });
    expect(clean.backup).toBeUndefined();
    expect(() => statSync(`${file}.bak`)).toThrow();
    expect(formatFixed(clean, file)).toContain('(previous version is in git)');
  });

  test('a symlinked project file stays a link and its target gets the new bytes', () => {
    const root = gitRepo();
    addPackage({ dir: root, name: 'srv', version: '1.0.0', bin: 'bin.js' });
    const target = path.join(root, '.agents', 'mcp.json');
    writeJson(target, { mcpServers: { srv: { command: 'npx', args: ['srv'] } } });
    const link = path.join(root, '.factory', 'mcp.json');
    mkdirSync(path.dirname(link));
    symlinkSync('../.agents/mcp.json', link);
    commitFile(root, target);
    commitFile(root, link);

    const outcome = applyProjectFix({ root, inGit: true, file: link });
    expect(outcome.backup).toBeUndefined();
    expect(lstatSync(link).isSymbolicLink()).toBe(true);
    expect(readMcpConfig(target).mcpServers['srv']?.command).toBe('sh');
    expect(() => lstatSync(`${link}.bak`)).toThrow();
    expect(() => lstatSync(`${target}.bak`)).toThrow();
  });

  test('shell syntax in a workspace path is passed as data, never run', () => {
    const root = gitRepo();
    const odd = path.join(root, 'apps', '$(touch injected)');
    writeFileSync(path.join(root, 'pnpm-workspace.yaml'), 'packages:\n  - apps/*\n');
    const pkg = addPackage({ dir: odd, name: 'srv', version: '1.0.0', bin: 'bin.js' });
    writeFileSync(path.join(pkg, 'bin.js'), 'console.log(process.argv.slice(2).join(" "));\n');
    const file = writeProjectMcp(root, { srv: { command: 'npx', args: ['srv', '--flag'] } });
    applyProjectFix({ root, inGit: true, file });

    const entry = readMcpConfig(file).mcpServers['srv'];
    const args = (entry?.args ?? []).map(String);
    const run = Bun.spawnSync(['sh', ...args], { cwd: root, stdout: 'pipe', stderr: 'pipe' });
    expect(run.stderr.toString()).toBe('');
    expect(run.stdout.toString()).toBe('--flag\n');
    expect(() => statSync(path.join(root, 'injected'))).toThrow();
  });

  test('a package the project lacks fails loud and leaves the file alone', () => {
    const root = gitRepo();
    const file = writeProjectMcp(root, {
      pg: { command: 'npx', args: ['-y', '@modelcontextprotocol/server-postgres'] },
    });
    const before = readFileSync(file, 'utf-8');
    expect(() => applyProjectFix({ root, inGit: true, file })).toThrow(
      `@modelcontextprotocol/server-postgres is not a dependency of ${root}; add it as a devDependency, then rerun ovrdroid doctor --fix`,
    );
    expect(readFileSync(file, 'utf-8')).toBe(before);
    expect(() => statSync(`${file}.bak`)).toThrow();
  });

  test('a project outside git is scanned but never fixed', () => {
    const root = makeTempDir('project');
    addPackage({ dir: root, name: 'srv', version: '1.0.0', bin: 'bin.js' });
    const file = writeProjectMcp(root, { srv: { command: 'npx', args: ['srv'] } });
    const before = readFileSync(file);
    const project = findProjectMcp(root, '/nowhere/mcp.json');
    expect(project).toEqual({ root, inGit: false, file });
    if (project === undefined) {
      throw new Error('project file not found');
    }
    expect(() => applyProjectFix(project)).toThrow(
      `cannot fix ${file}: ${root} is not a git repository; the portable command finds the project through git`,
    );
    expect(readFileSync(file).equals(before)).toBe(true);
    expect(() => statSync(`${file}.bak`)).toThrow();
  });

  test('project footguns point at the project fix', () => {
    const [found] = checkMcpConfig(
      { mcpServers: { srv: { command: 'npx', args: ['srv'] } } },
      'project',
    );
    expect(found?.fix).toContain('devDependency');
    expect(found?.impact).toContain('every new session waits');
  });
});
