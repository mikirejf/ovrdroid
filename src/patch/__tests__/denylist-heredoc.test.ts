import { describe, expect, test } from 'bun:test';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { patchSource } from '../../binary/apply.ts';
import { readApp } from '../../binary/graph.ts';
import { backupPath, INSTALLED_DROID } from '../../paths.ts';
import { denylistPatches } from '../denylist-patches.ts';
import { findMarker } from '../patches.ts';

type Matcher = (command: string, entries: readonly string[]) => string | null;

const MATCHER =
  /function (?<name>[\w$]+)\([\w$]+,(?<entries>[\w$]+),[\w$]+\)\{if\(\k<entries>\.length===0\)return null;/u;

const EXPORTED = 'ovrdroidDenyMatch';

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
        throw new Error(`the deny matcher imports ${imported}, which the bundle does not carry`);
      }
      queue.push(next);
    }
  }
  return path.join(dir, path.basename(start.name));
}

async function matcherOf(target: string): Promise<Matcher | undefined> {
  let app;
  try {
    app = readApp(await Bun.file(target).bytes());
  } catch {
    return undefined;
  }
  if (findMarker(app[0].text) !== undefined) {
    return undefined;
  }
  const patchedApp = patchSource(app, denylistPatches);
  const module = patchedApp.find((candidate) => MATCHER.test(candidate.text));
  const local = module === undefined ? undefined : MATCHER.exec(module.text)?.groups?.['name'];
  if (module === undefined || local === undefined) {
    throw new Error(`no module defines a deny matcher shaped like ${MATCHER.source}`);
  }
  const exposed = { name: module.name, text: `${module.text}export{${local} as ${EXPORTED}};` };
  const dir = mkdtempSync(path.join(tmpdir(), 'ovrdroid-denylist-'));
  const file = writeWithImports(exposed, patchedApp, dir);
  // SAFETY: the module is Droid's own permission matcher, and the name is the export added above.
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion
  const loaded = (await import(file)) as Record<string, Matcher>;
  return loaded[EXPORTED];
}

const match = (await matcherOf(INSTALLED_DROID)) ?? (await matcherOf(backupPath(INSTALLED_DROID)));

const DENY = ['init 6', 'halt', 'reboot', 'shutdown', 'rm -rf /', 'git push'];

function denied(command: string): string | null {
  return match?.(command, DENY) ?? null;
}

describe.skipIf(match === undefined)('a quoted heredoc body is text', () => {
  test.each([
    ["cat >> REPORT.md <<'EOF'\nsee `init 6` in init.BS957yFf.js:276\nEOF\n"],
    ["cat >> REPORT.md <<'EOF'\nsee $(init 6)\nEOF\n"],
    ["cat > run.sh <<'EOF'\ninit 6\nEOF\n"],
    ["python3 <<'EOF'\nreboot\nEOF\n"],
    ["bash -c 'echo hi' <<'EOF'\ninit 6\nEOF\n"],
  ])('%j passes', (command) => {
    expect(denied(command)).toBeNull();
  });
});

describe.skipIf(match === undefined)(
  'an unquoted heredoc body still runs its substitutions',
  () => {
    test.each([
      ['cat >> REPORT.md <<EOF\nsee `init 6`\nEOF\n', 'init 6'],
      ['cat >> REPORT.md <<EOF\nsee $(halt)\nEOF\n', 'halt'],
    ])('%j asks for %s', (command, entry) => {
      expect(denied(command)).toBe(entry);
    });
  },
);

describe.skipIf(match === undefined)('a heredoc fed to a shell is checked as commands', () => {
  test.each([
    ["bash <<'EOF'\ninit 6\nEOF\n", 'init 6'],
    ['sh <<EOF\nrm -rf /\nEOF\n', 'rm -rf /'],
    ['zsh <<-EOF\n\tshutdown now\n\tEOF\n', 'shutdown'],
    ["sudo bash <<'EOF'\necho hi\nreboot\nEOF\n", 'reboot'],
    ["cat <<'EOF' | bash\nshutdown now\nEOF\n", 'shutdown'],
    ["bash -s <<'EOF'\ngit push origin main\nEOF\n", 'git push'],
    ["/bin/bash <<'EOF'\nhalt\nEOF\n", 'halt'],
    ["bash <<'A' ; cat <<'B'\ninit 6\nA\nplain\nB\n", 'init 6'],
  ])('%j asks for %s', (command, entry) => {
    expect(denied(command)).toBe(entry);
  });
});
