import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

import { launchEnv, PROBE_SETTINGS } from './launch.ts';
import { Ledger } from './owned-sessions.ts';

const TOOL_MODE = ['--tool-execution-mode', 'direct-only'];

export interface ExecOptions {
  cwd: string;
  dir: string;
  model: string;
  effort: string;
  autonomy: string;
  prompt: string;
  timeoutMs: number;
}

export interface ExecEnd {
  exitCode: number | null;
  stderr: string;
  timedOut: boolean;
}

function settingsFor(options: ExecOptions): string {
  const file = path.join(options.dir, 'settings.json');
  writeFileSync(
    file,
    JSON.stringify({
      ...PROBE_SETTINGS,
      sessionDefaultSettings: { model: options.model, reasoningEffort: options.effort },
    }),
  );
  return file;
}

async function exitsWithin(child: Bun.Subprocess, ms: number): Promise<boolean> {
  const cancel = new AbortController();
  const expired = async (): Promise<boolean> => {
    try {
      await delay(ms, undefined, { signal: cancel.signal });
    } catch {
      return true;
    }
    return false;
  };
  const exited = async (): Promise<boolean> => {
    await child.exited;
    return true;
  };
  try {
    return await Promise.race([exited(), expired()]);
  } finally {
    cancel.abort();
  }
}

export async function runDirectExec<T>(
  binary: string,
  options: ExecOptions,
  read: (end: ExecEnd) => T,
): Promise<T> {
  const ledger = new Ledger(options.cwd);
  try {
    const child = Bun.spawn(
      [
        binary,
        'exec',
        ...TOOL_MODE,
        '-m',
        options.model,
        '-r',
        options.effort,
        '--auto',
        options.autonomy,
        '--cwd',
        options.cwd,
        options.prompt,
      ],
      {
        cwd: options.cwd,
        env: launchEnv({
          ...ledger.env,
          FACTORY_RUNTIME_SETTINGS_PATH: settingsFor(options),
        }),
        stdin: 'ignore',
        stdout: 'ignore',
        stderr: 'pipe',
      },
    );
    ledger.adopt(child);
    ledger.expectSession();
    const stderr = new Response(child.stderr).text();
    if (!(await exitsWithin(child, options.timeoutMs))) {
      return read({ exitCode: null, stderr: '', timedOut: true });
    }
    return read({
      exitCode: child.exitCode,
      stderr: await stderr,
      timedOut: false,
    });
  } finally {
    await ledger.release();
  }
}
