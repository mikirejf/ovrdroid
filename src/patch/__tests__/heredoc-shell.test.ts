import { describe, expect, test } from 'bun:test';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { patchSource } from '../../binary/apply.ts';
import { readApp } from '../../binary/graph.ts';
import { backupPath, INSTALLED_DROID } from '../../paths.ts';
import { findMarker, patches } from '../patches.ts';

type Commands = (command: string, options: { respectHeredocs: boolean }) => string[][];

const PARSER_EXPORT = 'function Pm(e,n){return A8(e,n).map(';

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
  const parser = patchSource(app, patches).find((module) => module.text.includes(PARSER_EXPORT));
  if (parser === undefined) {
    throw new Error(`no module defines ${PARSER_EXPORT}`);
  }
  const file = path.join(mkdtempSync(path.join(tmpdir(), 'ovrdroid-heredoc-')), 'parser.js');
  writeFileSync(file, parser.text);
  // SAFETY: the module is Droid's own command parser, and Pm is its exported splitter.
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion
  const loaded = (await import(file)) as { Pm: Commands };
  return loaded.Pm;
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
