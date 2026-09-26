import {
  chmodSync,
  copyFileSync,
  readdirSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';

import { hasErrorCode, messageOf } from '../cli.ts';
import { FACTORY_MCP, NPM_NPX_ROOT } from '../paths.ts';
import type { McpConfig, McpServerEntry } from './checks.ts';
import { checkMcpConfig, isWrapperCommand, wrapperBaseOf } from './checks.ts';
import type { PackageManifest } from './read.ts';
import { readManifest, readMcpConfig } from './read.ts';

export interface PackageSpec {
  name: string;
  version: string;
}

export interface WrapperInvocation {
  spec: string;
  passthrough: readonly string[];
  argv: readonly string[];
}

export interface FixedServer {
  server: string;
  fromCommand: string;
  fromArgs: readonly string[];
  toCommand: string;
  toArgs: readonly string[];
}

export interface FixOutcome {
  fixed: readonly FixedServer[];
  backup: string | undefined;
}

const VALUE_FLAGS = new Set(['-p', '--package']);
const LAUNCHERS = new Set(['exec', 'dlx', 'x']);

function rejectName(name: string, raw: string): void {
  if (
    name === '' ||
    name.includes(' ') ||
    name.includes(':') ||
    name.startsWith('.') ||
    name.startsWith('/') ||
    name.startsWith('~')
  ) {
    throw new Error(`"${raw}" is not a plain package name; pin this server by hand`);
  }
}

export function parsePackageSpec(raw: string): PackageSpec {
  const trimmed = raw.trim();
  if (trimmed === '' || trimmed.startsWith('-')) {
    throw new Error(`"${raw}" names no package; pin this server by hand`);
  }
  const at = trimmed.lastIndexOf('@');
  if (at <= 0) {
    rejectName(trimmed, raw);
    return { name: trimmed, version: '' };
  }
  const name = trimmed.slice(0, at);
  const version = trimmed.slice(at + 1);
  rejectName(name, raw);
  if (version === '' || version.includes(' ')) {
    throw new Error(`"${raw}" names no usable version; pin this server by hand`);
  }
  return { name, version };
}

export function splitWrapperArgs(args: readonly unknown[]): WrapperInvocation {
  const argv = args.map((arg) => {
    if (typeof arg !== 'string') {
      throw new TypeError(`an argument of type ${typeof arg} is not text; pin this server by hand`);
    }
    return arg;
  });
  let at = 0;
  let [head] = argv;
  while (head !== undefined && LAUNCHERS.has(head)) {
    at += 1;
    head = argv[at];
  }
  let spec = '';
  let cut = argv.length;
  for (let i = at; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === undefined) {
      break;
    }
    if (spec !== '') {
      cut = i;
      break;
    }
    if (token === '--') {
      cut = i + 1;
      break;
    }
    if (VALUE_FLAGS.has(token)) {
      const value = argv[i + 1];
      if (value === undefined) {
        throw new Error('a -p/--package flag has no value; pin this server by hand');
      }
      spec = value;
      i += 1;
      continue;
    }
    if (token.startsWith('--package=')) {
      spec = token.slice('--package='.length);
      continue;
    }
    if (token.startsWith('-')) {
      continue;
    }
    spec = token;
    cut = i + 1;
    if (argv[cut] === '--') {
      cut += 1;
    }
    break;
  }
  if (spec === '') {
    throw new Error('no package name found in args; pin this server by hand');
  }
  return { spec, passthrough: argv.slice(cut), argv };
}

export interface PackageCopy {
  dir: string;
  manifest: PackageManifest;
}

interface CachedCopy extends PackageCopy {
  mtimeMs: number;
}

export function wantsLatest(spec: PackageSpec): boolean {
  return spec.version === '' || spec.version === 'latest';
}

export function pinnedCopy<Copy extends PackageCopy>(
  copies: readonly Copy[],
  spec: PackageSpec,
  where: string,
): Copy {
  const pinned = copies.find((copy) => copy.manifest.version === spec.version);
  if (pinned === undefined) {
    const have = copies.map((copy) => String(copy.manifest.version)).join(', ');
    throw new Error(`${spec.name}@${spec.version} is not installed in ${where} (have ${have})`);
  }
  return pinned;
}

function cachedCopies(cacheRoot: string, name: string): CachedCopy[] {
  let hashes: string[];
  try {
    hashes = readdirSync(cacheRoot);
  } catch {
    throw new Error(
      `${cacheRoot} is unreadable; run the server once via npx so the cache exists, then retry`,
    );
  }
  const found: CachedCopy[] = [];
  for (const hash of hashes) {
    const manifestPath = path.join(cacheRoot, hash, 'node_modules', name, 'package.json');
    let manifest: PackageManifest;
    let mtimeMs = 0;
    try {
      manifest = readManifest(manifestPath);
      mtimeMs = statSync(manifestPath).mtimeMs;
    } catch {
      continue;
    }
    if (typeof manifest.version !== 'string') {
      continue;
    }
    found.push({ dir: path.dirname(manifestPath), mtimeMs, manifest });
  }
  return found;
}

export function resolvePackageDir(cacheRoot: string, spec: PackageSpec): PackageCopy {
  const found = cachedCopies(cacheRoot, spec.name);
  const [newest] = found.toSorted((a, b) => b.mtimeMs - a.mtimeMs);
  if (newest === undefined) {
    throw new Error(
      `${spec.name} is not in ${cacheRoot}; run it once via npx so the cache exists, then retry`,
    );
  }
  return wantsLatest(spec) ? newest : pinnedCopy(found, spec, cacheRoot);
}

export function resolveBinPath(copy: PackageCopy, packageName: string): string {
  const { dir: pkgDir, manifest } = copy;
  const manifestPath = path.join(pkgDir, 'package.json');
  const bin: unknown = manifest.bin;
  let relative = '';
  if (typeof bin === 'string') {
    relative = bin;
  } else if (typeof bin === 'object' && bin !== null) {
    const entries = Object.entries(bin);
    const short = packageName.split('/').pop() ?? packageName;
    const match = entries.find(([key]) => key === short || key === packageName);
    if (match !== undefined && typeof match[1] === 'string') {
      relative = match[1];
    } else if (entries.length === 1) {
      const [only] = entries;
      if (only !== undefined && typeof only[1] === 'string') {
        relative = only[1];
      }
    }
  }
  if (relative === '') {
    throw new Error(`${manifestPath} names no usable bin; pin this server by hand`);
  }
  const absolute = path.join(pkgDir, relative);
  if (statSync(absolute, { throwIfNoEntry: false })?.isFile() !== true) {
    throw new Error(`${absolute} does not resolve to a file; pin this server by hand`);
  }
  return absolute;
}

interface WrapperRequest {
  server: string;
  invocation: WrapperInvocation;
  spec: PackageSpec;
}

interface Rewrite {
  command: string;
  args: readonly string[];
}

export type Rewriter = (request: WrapperRequest) => Rewrite;

interface WrapperEntry {
  server: string;
  command: string;
  args: readonly unknown[];
}

function rewriteEntry(wrapper: WrapperEntry, rewriter: Rewriter): FixedServer {
  const { server, command } = wrapper;
  const base = wrapperBaseOf(command);
  if (base !== 'npm' && base !== 'npx') {
    throw new Error(`${base} wrappers are not autofixed; pin this server by hand`);
  }
  const invocation = splitWrapperArgs(wrapper.args);
  const spec = parsePackageSpec(invocation.spec);
  const to = rewriter({ server, invocation, spec });
  return {
    server,
    fromCommand: command,
    fromArgs: invocation.argv,
    toCommand: to.command,
    toArgs: to.args,
  };
}

function pinToCache(cacheRoot: string): Rewriter {
  return ({ invocation, spec }) => ({
    command: 'node',
    args: [
      realpathSync(resolveBinPath(resolvePackageDir(cacheRoot, spec), spec.name)),
      ...invocation.passthrough,
    ],
  });
}

export function rewriteWrappers(
  mcpPath: string,
  rewriter: Rewriter,
  needsBackup: (target: string) => boolean,
): FixOutcome {
  let raw: McpConfig;
  try {
    raw = readMcpConfig(mcpPath);
  } catch (error) {
    if (hasErrorCode(error, 'ENOENT')) {
      return { fixed: [], backup: undefined };
    }
    throw new Error(`cannot fix ${mcpPath}: ${messageOf(error)}`, { cause: error });
  }
  const next: Record<string, McpServerEntry> = {};
  const fixed: FixedServer[] = [];
  const failures: string[] = [];
  for (const [server, entry] of Object.entries(raw.mcpServers)) {
    const command: unknown = entry.command;
    if (entry.disabled === true || !isWrapperCommand(command)) {
      next[server] = entry;
      continue;
    }
    try {
      const item = rewriteEntry({ server, command, args: entry.args ?? [] }, rewriter);
      next[server] = { ...entry, command: item.toCommand, args: item.toArgs };
      fixed.push(item);
    } catch (error) {
      next[server] = entry;
      failures.push(`${server}: ${messageOf(error)}`);
    }
  }
  if (failures.length > 0) {
    throw new Error(`cannot fix ${mcpPath}:\n${failures.join('\n')}`);
  }
  if (fixed.length === 0) {
    return { fixed, backup: undefined };
  }
  const rewritten = { ...raw, mcpServers: next };
  if (checkMcpConfig(rewritten, 'user').length > 0) {
    throw new Error(`cannot fix ${mcpPath}: the rewritten config still flags wrappers`);
  }
  const target = realpathSync(mcpPath);
  const backup = needsBackup(target) ? `${target}.bak` : undefined;
  if (backup !== undefined) {
    copyFileSync(target, backup);
  }
  const { mode } = statSync(target);
  const temporary = `${target}.tmp`;
  try {
    writeFileSync(temporary, `${JSON.stringify(rewritten, null, 2)}\n`);
    chmodSync(temporary, mode);
    renameSync(temporary, target);
  } finally {
    rmSync(temporary, { force: true });
  }
  return { fixed, backup };
}

export function applyFix(
  mcpPath: string = FACTORY_MCP,
  cacheRoot: string = NPM_NPX_ROOT,
): FixOutcome {
  return rewriteWrappers(mcpPath, pinToCache(cacheRoot), () => true);
}
