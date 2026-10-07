import { describe, expect, test } from 'bun:test';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { patchSource } from '../../binary/apply.ts';
import { readApp } from '../../binary/graph.ts';
import { backupPath, INSTALLED_DROID } from '../../paths.ts';
import { findMarker, patches } from '../patches.ts';

type Commands = (command: string, options: { respectHeredocs: boolean }) => string[][];

const SPLITTER =
  /function (?<name>[\w$]+)\((?<a>[\w$]+),(?<b>[\w$]+)\)\{return [\w$]+\(\k<a>,\k<b>\)\.map\(\(\{argv:(?<c>[\w$]+)\}\)=>\k<c>\)\}/u;

function exportedName(text: string, local: string): string {
  const exports = /export\{(?<list>[^}]*)\}/u.exec(text)?.groups?.['list'] ?? '';
  for (const entry of exports.split(',')) {
    const [name, alias] = entry.split(' as ');
    if (name === local) {
      return alias ?? name;
    }
  }
  throw new Error(`the command parser module does not export its splitter ${local}`);
}

const BUN_ROOT = '/$bunfs/root/';

function writeWithImports(
  start: { name: string; text: string },
  modules: readonly { name: string; text: string }[],
  dir: string,
): string {
  const queue = [start];
  const written = new Set<string>();
  for (const module of queue) {
    const base = path.basename(module.name);
    if (written.has(base)) {
      continue;
    }
    written.add(base);
    writeFileSync(path.join(dir, base), module.text.replaceAll(BUN_ROOT, './'));
    for (const [, imported] of module.text.matchAll(/from"\/\$bunfs\/root\/(?<file>[^"]+)"/gu)) {
      const next = modules.find((candidate) => path.basename(candidate.name) === imported);
      if (next === undefined) {
        throw new Error(`the command parser imports ${imported}, which the bundle does not carry`);
      }
      queue.push(next);
    }
  }
  return path.join(dir, path.basename(start.name));
}

async function parserOf(target: string): Promise<Commands | undefined> {
  let app;
  try {
    app = readApp(await Bun.file(target).bytes());
  } catch {
    return undefined;
  }
  if (findMarker(app[0].text) !== undefined) {
    return undefined;
  }
  const patchedApp = patchSource(app, patches);
  const parser = patchedApp.find((module) => SPLITTER.test(module.text));
  const local = parser === undefined ? undefined : SPLITTER.exec(parser.text)?.groups?.['name'];
  if (parser === undefined || local === undefined) {
    throw new Error(`no module defines a splitter shaped like ${SPLITTER.source}`);
  }
  const dir = mkdtempSync(path.join(tmpdir(), 'ovrdroid-heredoc-'));
  const file = writeWithImports(parser, patchedApp, dir);
  // SAFETY: the module is Droid's own command parser, and the name is its exported splitter.
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion
  const loaded = (await import(file)) as Record<string, Commands>;
  return loaded[exportedName(parser.text, local)];
}

const parse = (await parserOf(INSTALLED_DROID)) ?? (await parserOf(backupPath(INSTALLED_DROID)));

function commandsIn(command: string): string[] {
  return (parse?.(command, { respectHeredocs: true }) ?? []).map((argv) => argv.join(' '));
}

describe.skipIf(parse === undefined)('a heredoc fed to a shell is checked as commands', () => {
  test.each([
    ["bash <<'EOF'\ninit 6\nEOF\n", 'init 6'],
    ['sh <<EOF\nrm -rf /\nEOF\n', 'rm -rf /'],
    ['zsh <<-EOF\n\tshutdown now\n\tEOF\n', 'shutdown now'],
    ["sudo bash <<'EOF'\necho hi\nreboot\nEOF\n", 'reboot'],
    ["cat <<'EOF' | bash\nshutdown now\nEOF\n", 'shutdown now'],
    ["bash -s <<'EOF'\ngit push origin main\nEOF\n", 'git push origin main'],
    ["/bin/bash <<'EOF'\nhalt\nEOF\n", 'halt'],
    ["bash <<'A' ; cat <<'B'\ninit 6\nA\nplain\nB\n", 'init 6'],
  ])('%j runs %s', (command, inner) => {
    expect(commandsIn(command)).toContain(inner);
  });
});

describe.skipIf(parse === undefined)('a heredoc fed to anything else stays text', () => {
  test.each([
    ["cat > run.sh <<'EOF'\ninit 6\nEOF\n", 'init 6'],
    ["cat > notes <<'EOF'\nplease halt\nEOF\n", 'please halt'],
    ["bash -c 'echo hi' <<'EOF'\ninit 6\nEOF\n", 'init 6'],
    ["python3 <<'EOF'\nreboot\nEOF\n", 'reboot'],
  ])('%j never runs %s', (command, inner) => {
    expect(commandsIn(command)).not.toContain(inner);
  });
});
