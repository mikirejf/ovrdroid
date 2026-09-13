import { afterAll, describe, expect, test } from 'bun:test';
import { chmodSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { messageOf } from '../src/cli.ts';
import { launch, launchEnv } from '../src/launch.ts';

const LAUNCH_SRC = path.join(import.meta.dir, '..', 'src', 'launch.ts');
const MARKER = '╰';
const dir = await mkdtemp(path.join(tmpdir(), 'overdroid-launch-'));

afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

async function script(name: string, body: string): Promise<string> {
  const file = path.join(dir, name);
  await Bun.write(file, `#!/bin/sh\n${body}\n`);
  chmodSync(file, 0o755);
  return file;
}

const healthy = await script(
  'healthy.sh',
  ['stty raw -echo', `printf '${MARKER}'`, 'dd bs=1 count=1 >/dev/null 2>&1', 'exit 0'].join('\n'),
);
const crashing = await script('crashing.sh', [`printf '${MARKER}'`, 'exit 42'].join('\n'));
const silent = await script('silent.sh', 'sleep 30');
const stillborn = await script('stillborn.sh', 'exit 3');

async function rejection(work: Promise<unknown>): Promise<string> {
  try {
    await work;
  } catch (error) {
    return messageOf(error);
  }
  throw new Error('expected a rejection');
}

describe('launch', () => {
  test('times a healthy target and reports its pid', async () => {
    const result = await launch(healthy, { settleMs: 50 });
    expect(result.paintMs).toBeGreaterThan(0);
    expect(result.paintMs).toBeLessThan(10_000);
    expect(result.exitMs).toBeGreaterThan(0);
    expect(result.exitMs).toBeLessThan(10_000);
    expect(result.pid).toBeGreaterThan(0);
    expect(result.pid).not.toBe(process.pid);
  }, 30_000);

  test('rejects when the target exits before settling', async () => {
    expect(await rejection(launch(crashing, { settleMs: 100 }))).toContain('42');
  }, 30_000);

  test('reports the exit code rather than waiting out the paint timeout', async () => {
    const started = performance.now();
    const message = await rejection(launch(stillborn, { paintTimeoutMs: 20_000 }));
    expect(message).toBe('exited with code 3 before painting');
    expect(performance.now() - started).toBeLessThan(5000);
  }, 30_000);

  test('rejects when the target never paints', async () => {
    expect(await rejection(launch(silent, { paintTimeoutMs: 300 }))).toContain(
      'no input box after 300ms',
    );
  }, 30_000);

  test('leaves no pending timer behind', async () => {
    const runner = path.join(dir, 'runner.ts');
    await Bun.write(
      runner,
      [
        `import { launch } from ${JSON.stringify(LAUNCH_SRC)};`,
        `await launch(${JSON.stringify(healthy)}, { settleMs: 50 });`,
      ].join('\n'),
    );
    const started = performance.now();
    const child = Bun.spawn([process.execPath, 'run', runner], { stdout: 'pipe', stderr: 'pipe' });
    const code = await child.exited;
    expect(code).toBe(0);
    expect(performance.now() - started).toBeLessThan(15_000);
  }, 40_000);
});

describe('launchEnv', () => {
  const injected = {
    FACTORY_ENV: 'droid',
    FACTORY_DISABLE_SETTINGS_PERSISTENCE: 'true',
    DROID_PROFILE: '1',
    HERDR_PANE_ID: '7',
    FORCE_COLOR: '3',
    BUN_OPTIONS: '--cpu-prof',
  };

  test('strips injected names, keeps BUN_ and forces auto-update off', () => {
    for (const [key, value] of Object.entries(injected)) {
      Bun.env[key] = value;
    }
    try {
      const env = launchEnv();
      expect(env['BUN_OPTIONS']).toBe('--cpu-prof');
      expect(env['FORCE_COLOR']).toBeUndefined();
      expect(env['FACTORY_ENV']).toBeUndefined();
      expect(env['FACTORY_DISABLE_SETTINGS_PERSISTENCE']).toBeUndefined();
      expect(env['DROID_PROFILE']).toBeUndefined();
      expect(env['HERDR_PANE_ID']).toBeUndefined();
      expect(env['FACTORY_DROID_AUTO_UPDATE_ENABLED']).toBe('false');
      expect(env['TERM']).toBe('xterm-256color');
    } finally {
      for (const key of Object.keys(injected)) {
        Reflect.deleteProperty(Bun.env, key);
      }
    }
  });

  test('lets caller entries win', () => {
    expect(launchEnv({ TERM: 'dumb' })['TERM']).toBe('dumb');
  });
});
