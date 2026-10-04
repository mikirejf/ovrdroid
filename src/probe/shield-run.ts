import { appendFile, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { withTempDir } from '../temp.ts';
import { measureExec } from './exec.ts';
import type { ShieldCase, ShieldReading } from './shield.ts';
import { readShield, SHIELD_PROMPT } from './shield.ts';

export const SHIELD_TIMEOUT_MS = 240_000;

const REPO_CONFIG = [
  '[user]',
  '\tname = probe',
  '\temail = probe@example.invalid',
  '[commit]',
  '\tgpgsign = false',
  '[core]',
  '\thooksPath = /dev/null',
  '',
].join('\n');

async function git(dir: string, args: readonly string[]): Promise<void> {
  const child = Bun.spawn(['git', '-C', dir, ...args], { stdout: 'ignore', stderr: 'pipe' });
  const [stderr] = await Promise.all([new Response(child.stderr).text(), child.exited]);
  if (child.exitCode !== 0) {
    throw new Error(`git ${args.join(' ')} failed: ${stderr.trim()}`);
  }
}

async function writeCase(dir: string, shieldCase: ShieldCase): Promise<void> {
  const file = path.join(dir, shieldCase.path);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, `${shieldCase.line}\n`);
}

async function stageCases(dir: string, cases: readonly ShieldCase[]): Promise<void> {
  await git(dir, ['init', '--quiet']);
  await appendFile(path.join(dir, '.git', 'config'), REPO_CONFIG);
  await Promise.all(
    cases.map(async (shieldCase) => {
      await writeCase(dir, shieldCase);
    }),
  );
  await git(dir, ['add', '--all']);
}

export function shieldArgv(dir: string, model: string): string[] {
  return [
    'exec',
    '--auto',
    'medium',
    '-m',
    model,
    '-o',
    'stream-json',
    '--cwd',
    dir,
    SHIELD_PROMPT,
  ];
}

export async function runShield(
  binary: string,
  model: string,
  cases: readonly ShieldCase[],
): Promise<ShieldReading> {
  return await withTempDir('shield', async (dir) => {
    await stageCases(dir, cases);
    const run = await measureExec(
      binary,
      { argv: shieldArgv(dir, model), createsSession: true },
      SHIELD_TIMEOUT_MS,
    );
    if (run.signal !== null || run.exitCode !== 0) {
      throw new Error(
        `${binary} exec ended with ${run.signal ?? `exit ${run.exitCode}`}: ${run.stderr.trim()}`,
      );
    }
    return readShield(run.stdout);
  });
}
