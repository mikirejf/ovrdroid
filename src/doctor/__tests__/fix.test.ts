import { describe, expect, test } from 'bun:test';
import { chmodSync, mkdirSync, readFileSync, statSync, utimesSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { makeTempDir } from '../../temp.ts';
import type { McpConfig } from '../checks.ts';
import { checkMcpConfig } from '../checks.ts';
import type { PackageCopy } from '../fix.ts';
import {
  applyFix,
  parsePackageSpec,
  resolveBinPath,
  resolvePackageDir,
  splitWrapperArgs,
} from '../fix.ts';
import { readManifest } from '../read.ts';
import { scanMcpConfig } from '../scan.ts';

interface FakeManifest {
  name: string;
  version: string;
  bin: string | Record<string, string>;
}

interface FakeCopy {
  cache: string;
  hash: string;
  name: string;
  manifest: FakeManifest;
}

function addCopy(copy: FakeCopy): string {
  const dir = path.join(copy.cache, copy.hash, 'node_modules', copy.name);
  mkdirSync(dir, { recursive: true });
  const file = path.join(dir, 'package.json');
  writeFileSync(file, JSON.stringify(copy.manifest));
  return dir;
}

function copyOf(dir: string): PackageCopy {
  return { dir, manifest: readManifest(path.join(dir, 'package.json')) };
}

function addBin(dir: string, relative: string): string {
  const file = path.join(dir, relative);
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, '#!/usr/bin/env node\n');
  return file;
}

function stamp(file: string, epochSeconds: number): void {
  utimesSync(file, epochSeconds, epochSeconds);
}

function configOf(servers: McpConfig['mcpServers']): McpConfig {
  return { mcpServers: servers };
}

function writeMcp(dir: string, config: McpConfig): string {
  const file = path.join(dir, 'mcp.json');
  writeFileSync(file, `${JSON.stringify(config, null, 2)}\n`);
  chmodSync(file, 0o600);
  return file;
}

describe('parsePackageSpec splits name and version', () => {
  test('bare, tagged and versioned specs', () => {
    expect(parsePackageSpec('chrome-devtools-mcp')).toEqual({
      name: 'chrome-devtools-mcp',
      version: '',
    });
    expect(parsePackageSpec('chrome-devtools-mcp@latest')).toEqual({
      name: 'chrome-devtools-mcp',
      version: 'latest',
    });
    expect(parsePackageSpec('chrome-devtools-mcp@1.2.3')).toEqual({
      name: 'chrome-devtools-mcp',
      version: '1.2.3',
    });
  });

  test('scoped packages keep their scope', () => {
    expect(parsePackageSpec('@scope/pkg')).toEqual({ name: '@scope/pkg', version: '' });
    expect(parsePackageSpec('@scope/pkg@2.0.0')).toEqual({ name: '@scope/pkg', version: '2.0.0' });
  });

  test('flags, paths and urls are refused', () => {
    for (const raw of ['', '-y', './local', '/abs/path', 'https://x/y.tgz', 'pkg@']) {
      expect(() => parsePackageSpec(raw)).toThrow();
    }
  });
});

describe('splitWrapperArgs finds the package and the passthrough', () => {
  test('npx with -y and server flags', () => {
    expect(splitWrapperArgs(['-y', 'chrome-devtools-mcp@latest', '--browserUrl', 'x'])).toEqual({
      spec: 'chrome-devtools-mcp@latest',
      passthrough: ['--browserUrl', 'x'],
      argv: ['-y', 'chrome-devtools-mcp@latest', '--browserUrl', 'x'],
    });
  });

  test('npm exec and -- separators', () => {
    expect(splitWrapperArgs(['exec', '-y', 'pkg', '--', '--bar'])).toEqual({
      spec: 'pkg',
      passthrough: ['--bar'],
      argv: ['exec', '-y', 'pkg', '--', '--bar'],
    });
  });

  test('package flags carry the spec', () => {
    expect(splitWrapperArgs(['--package=pkg', '--foo'])).toEqual({
      spec: 'pkg',
      passthrough: ['--foo'],
      argv: ['--package=pkg', '--foo'],
    });
    expect(splitWrapperArgs(['-p', 'pkg', '--foo'])).toEqual({
      spec: 'pkg',
      passthrough: ['--foo'],
      argv: ['-p', 'pkg', '--foo'],
    });
  });

  test('missing specs and non-text args are refused', () => {
    expect(() => splitWrapperArgs([])).toThrow();
    expect(() => splitWrapperArgs(['-y'])).toThrow();
    expect(() => splitWrapperArgs(['pkg', 7])).toThrow();
  });
});

describe('resolvePackageDir picks the cached copy', () => {
  test('an unreadable cache root is refused', () => {
    expect(() => resolvePackageDir('/definitely/not/here', { name: 'pkg', version: '' })).toThrow();
  });

  test('a missing package is refused', () => {
    expect(() => resolvePackageDir(makeTempDir('doctor'), { name: 'pkg', version: '' })).toThrow();
  });

  test('the newest copy wins unless a version is pinned', () => {
    const cache = makeTempDir('doctor');
    const oldDir = addCopy({
      cache,
      hash: 'aaa',
      name: 'pkg',
      manifest: { name: 'pkg', version: '1.0.0', bin: 'a.js' },
    });
    const newDir = addCopy({
      cache,
      hash: 'bbb',
      name: 'pkg',
      manifest: { name: 'pkg', version: '2.0.0', bin: 'a.js' },
    });
    stamp(path.join(oldDir, 'package.json'), 1_000_000_000);
    stamp(path.join(newDir, 'package.json'), 2_000_000_000);
    expect(resolvePackageDir(cache, { name: 'pkg', version: '' }).dir).toBe(newDir);
    expect(resolvePackageDir(cache, { name: 'pkg', version: 'latest' }).dir).toBe(newDir);
    expect(resolvePackageDir(cache, { name: 'pkg', version: '1.0.0' }).dir).toBe(oldDir);
    expect(() => resolvePackageDir(cache, { name: 'pkg', version: '3.0.0' })).toThrow();
  });
});

describe('resolveBinPath follows the manifest bin', () => {
  test('a string bin resolves', () => {
    const cache = makeTempDir('doctor');
    const dir = addCopy({
      cache,
      hash: 'aaa',
      name: 'pkg',
      manifest: { name: 'pkg', version: '1.0.0', bin: 'bin/run.js' },
    });
    const js = addBin(dir, 'bin/run.js');
    expect(resolveBinPath(copyOf(dir), 'pkg')).toBe(js);
  });

  test('a bin map prefers the package name, then a lone entry', () => {
    const cache = makeTempDir('doctor');
    const multi = addCopy({
      cache,
      hash: 'aaa',
      name: 'pkg',
      manifest: {
        name: 'pkg',
        version: '1.0.0',
        bin: { other: 'other.js', pkg: 'pkg.js' },
      },
    });
    const multiJs = addBin(multi, 'pkg.js');
    expect(resolveBinPath(copyOf(multi), 'pkg')).toBe(multiJs);
    const lone = addCopy({
      cache,
      hash: 'bbb',
      name: 'solo',
      manifest: {
        name: 'solo',
        version: '1.0.0',
        bin: { whatever: 'run.js' },
      },
    });
    const loneJs = addBin(lone, 'run.js');
    expect(resolveBinPath(copyOf(lone), 'solo')).toBe(loneJs);
  });

  test('ambiguous or missing bins are refused', () => {
    const cache = makeTempDir('doctor');
    const ambiguous = addCopy({
      cache,
      hash: 'aaa',
      name: 'pkg',
      manifest: {
        name: 'pkg',
        version: '1.0.0',
        bin: { a: 'a.js', b: 'b.js' },
      },
    });
    expect(() => resolveBinPath(copyOf(ambiguous), 'pkg')).toThrow();
    const missing = addCopy({
      cache,
      hash: 'bbb',
      name: 'bare',
      manifest: {
        name: 'bare',
        version: '1.0.0',
        bin: 'run.js',
      },
    });
    expect(() => resolveBinPath(copyOf(missing), 'bare')).toThrow();
  });
});

describe('applyFix rewrites wrappers to pinned entry points', () => {
  test('a wrapper becomes node plus the resolved bin, with backup and mode kept', () => {
    const dir = makeTempDir('doctor');
    const cache = path.join(dir, 'cache');
    mkdirSync(cache, { recursive: true });
    const pkgDir = addCopy({
      cache,
      hash: 'aaa',
      name: 'chrome-devtools-mcp',
      manifest: {
        name: 'chrome-devtools-mcp',
        version: '1.0.0',
        bin: 'build/bin.js',
      },
    });
    const js = addBin(pkgDir, 'build/bin.js');
    const file = writeMcp(
      dir,
      configOf({
        wrapped: {
          command: 'npx',
          args: ['-y', 'chrome-devtools-mcp@latest', '--browserUrl', 'http://127.0.0.1:9333'],
        },
        pinned: { command: 'node', args: ['/x/bin.js'] },
        off: { command: 'npx', args: ['-y', 'other'], disabled: true },
      }),
    );
    const before = readFileSync(file, 'utf-8');

    const outcome = applyFix(file, cache);

    expect(outcome.backup).toBe(`${file}.bak`);
    expect(outcome.fixed.map((item) => item.server)).toEqual(['wrapped']);
    expect(outcome.fixed[0]?.toCommand).toBe('node');
    expect(outcome.fixed[0]?.toArgs[0]).toBe(js);
    expect(outcome.fixed[0]?.toArgs.slice(1)).toEqual(['--browserUrl', 'http://127.0.0.1:9333']);
    expect(readFileSync(`${file}.bak`, 'utf-8')).toBe(before);
    expect(statSync(file).mode).toBe(statSync(`${file}.bak`).mode);

    const rewritten: unknown = JSON.parse(readFileSync(file, 'utf-8'));
    expect(checkMcpConfig(rewritten, 'user')).toHaveLength(0);
    expect(scanMcpConfig(file, 'user')).toHaveLength(0);

    const again = applyFix(file, cache);
    expect(again.fixed).toHaveLength(0);
    expect(readFileSync(`${file}.bak`, 'utf-8')).toBe(before);
  });

  test('an unresolvable package fails loud and leaves the file alone', () => {
    const dir = makeTempDir('doctor');
    const file = writeMcp(
      dir,
      configOf({ wrapped: { command: 'npx', args: ['-y', 'ghost-pkg@latest'] } }),
    );
    const before = readFileSync(file, 'utf-8');
    expect(() => applyFix(file, path.join(dir, 'cache'))).toThrow();
    expect(readFileSync(file, 'utf-8')).toBe(before);
    expect(() => statSync(`${file}.bak`)).toThrow();
  });

  test('a missing file has nothing to fix, as a scan finds nothing in it', () => {
    const dir = makeTempDir('doctor');
    const file = path.join(dir, 'mcp.json');
    expect(applyFix(file, path.join(dir, 'cache'))).toEqual({ fixed: [], backup: undefined });
    expect(() => statSync(file)).toThrow();
  });

  test('a broken file fails loud', () => {
    const dir = makeTempDir('doctor');
    const file = path.join(dir, 'mcp.json');
    writeFileSync(file, 'not json\n');
    expect(() => applyFix(file, path.join(dir, 'cache'))).toThrow();
  });
});
