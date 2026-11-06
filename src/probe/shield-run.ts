import { appendFile, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { withTempDir } from '../temp.ts';
import { measureExec } from './exec.ts';
import type { ShieldCase, ShieldReading } from './shield.ts';
import {
  CONFLICT_COMMIT,
  CONFLICT_FILE,
  readShield,
  SHIELD_COMMIT,
  shieldPrompt,
} from './shield.ts';
import { startStubModel, stubSettings } from './stub-model.ts';

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

async function git(dir: string, args: readonly string[], okCode = 0): Promise<void> {
  const child = Bun.spawn(['git', '-C', dir, ...args], { stdout: 'ignore', stderr: 'pipe' });
  const [stderr] = await Promise.all([new Response(child.stderr).text(), child.exited]);
  if (child.exitCode !== okCode) {
    throw new Error(`git ${args.join(' ')} failed: ${stderr.trim()}`);
  }
}

async function writeCase(dir: string, shieldCase: ShieldCase): Promise<void> {
  const file = path.join(dir, shieldCase.path);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, `${shieldCase.line}\n`);
}

async function initRepo(dir: string): Promise<void> {
  await git(dir, ['init', '--quiet', '-b', 'main']);
  await appendFile(path.join(dir, '.git', 'config'), REPO_CONFIG);
}

async function commitFile(dir: string, name: string, content: string): Promise<void> {
  await writeFile(path.join(dir, name), content);
  await git(dir, ['add', name]);
  await git(dir, ['commit', '--quiet', '-m', name]);
}

async function stageConflict(dir: string): Promise<void> {
  await initRepo(dir);
  await commitFile(dir, 'clash.txt', 'base\n');
  await git(dir, ['checkout', '--quiet', '-b', 'side']);
  await commitFile(dir, 'clash.txt', 'side\n');
  await git(dir, ['checkout', '--quiet', 'main']);
  await commitFile(dir, 'clash.txt', 'main\n');
  await git(dir, ['merge', 'side'], 1);
  await writeFile(path.join(dir, CONFLICT_FILE), 'staged\n');
}

async function stageCases(dir: string, cases: readonly ShieldCase[]): Promise<void> {
  await initRepo(dir);
  await Promise.all(
    cases.map(async (shieldCase) => {
      await writeCase(dir, shieldCase);
    }),
  );
  await git(dir, ['add', '--all']);
}

export function shieldArgv(dir: string, model: string, command: string): string[] {
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
    shieldPrompt(command),
  ];
}

export interface ShieldScenario {
  command: string;
  stage: (dir: string) => Promise<void>;
}

export function commitScenario(cases: readonly ShieldCase[]): ShieldScenario {
  return {
    command: SHIELD_COMMIT,
    stage: async (dir) => {
      await stageCases(dir, cases);
    },
  };
}

export const CONFLICT_SCENARIO: ShieldScenario = {
  command: CONFLICT_COMMIT,
  stage: stageConflict,
};

export async function runShield(
  binary: string,
  model: string | undefined,
  scenario: ShieldScenario,
): Promise<ShieldReading> {
  return await withTempDir('shield', async (dir) => {
    await scenario.stage(dir);
    const stub =
      model === undefined
        ? startStubModel(
            { chars: 0, chunk: 1024, gapMs: 0 },
            {
              name: 'Execute',
              input: {
                command: scenario.command,
                riskLevel: 'medium',
                summary: 'Commit probe fixtures',
              },
            },
          )
        : undefined;
    try {
      const settings = path.join(dir, 'settings.json');
      const flags = path.join(dir, 'feature-flags.json');
      if (stub !== undefined) {
        await writeFile(
          settings,
          JSON.stringify({ ...stubSettings(stub.url), droidShieldEnabled: true }),
        );
        await writeFile(flags, JSON.stringify({ flags: {}, configs: {} }));
      }
      const run = await measureExec(
        binary,
        {
          argv: shieldArgv(dir, model ?? 'custom:stub-stream', scenario.command),
          createsSession: true,
          env:
            stub === undefined
              ? {}
              : {
                  FACTORY_RUNTIME_SETTINGS_PATH: settings,
                  FACTORY_FEATURE_FLAGS_SNAPSHOT_PATH: flags,
                },
        },
        SHIELD_TIMEOUT_MS,
      );
      if (run.signal !== null || run.exitCode !== 0) {
        throw new Error(
          `${binary} exec ended with ${run.signal ?? `exit ${run.exitCode}`}: ${run.stderr.trim()}`,
        );
      }
      return readShield(run.stdout);
    } finally {
      await stub?.stop();
    }
  });
}
