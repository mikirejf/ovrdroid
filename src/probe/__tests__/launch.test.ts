import { afterAll, describe, expect, test } from 'bun:test';
import { rm } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';

import { launch, launchEnv, PROBE_SETTINGS, PROBE_SETTINGS_FILE } from '../launch.ts';
import { LEDGER_VARIABLE } from '../ledger.ts';
import { START_HOOK_BOUND_MS } from '../owned-sessions.ts';
import { PAINT_MARKER, rejection, script, scriptDir, START_HOOK } from './scripts.ts';

const LAUNCH_SRC = path.join(import.meta.dir, '..', 'launch.ts');
const dir = scriptDir('launch');

afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

const healthy = await script(dir, 'healthy.sh', [
  'stty raw -echo',
  `printf '${PAINT_MARKER}'`,
  START_HOOK,
  'dd bs=1 count=1 >/dev/null 2>&1',
  'exit 0',
]);
const interrupted = await script(dir, 'interrupted.sh', [
  'stty raw -echo',
  `printf '${PAINT_MARKER}'`,
  START_HOOK,
  'dd bs=1 count=1 >/dev/null 2>&1',
  'exit 130',
]);
const hookless = await script(dir, 'hookless.sh', [
  'stty raw -echo',
  `printf '${PAINT_MARKER}'`,
  'trap "exit 0" INT',
  'while :; do sleep 0.05; done',
]);
const slowRecord = await script(dir, 'slow-record.sh', [
  'stty raw -echo',
  `printf '${PAINT_MARKER}'`,
  `( sleep 0.5; ${START_HOOK} ) &`,
  'dd bs=1 count=1 >/dev/null 2>&1',
  `[ -f "$${LEDGER_VARIABLE}/start" ] || exit 9`,
  'exit 0',
]);
const crashing = await script(dir, 'crashing.sh', [
  `printf '${PAINT_MARKER}'`,
  START_HOOK,
  'sleep 0.05',
  'exit 42',
]);
const silent = await script(dir, 'silent.sh', ['sleep 30']);
const stillborn = await script(dir, 'stillborn.sh', ['exit 3']);

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

  test('accepts the conventional Ctrl-C exit code 130 as a clean exit', async () => {
    const result = await launch(interrupted, { settleMs: 50 });
    expect(result.paintMs).toBeGreaterThan(0);
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

  test('presses Ctrl-C only after the session reported in, so an early exit cannot hide it', async () => {
    const result = await launch(slowRecord, { settleMs: 50 });
    expect(result.paintMs).toBeLessThan(400);
  }, 30_000);

  test('stops a target whose session never reported in, and says why', async () => {
    const listeners = process.listenerCount('SIGINT');
    const started = performance.now();
    const message = await rejection(launch(hookless, { settleMs: 50 }));
    expect(message).toContain("ran neither the probe's SessionStart nor its SessionEnd hook");
    expect(message).toContain(`may remain in ${homedir()}/.factory/sessions/-`);
    expect(performance.now() - started).toBeGreaterThanOrEqual(START_HOOK_BOUND_MS);
    expect(process.listenerCount('SIGINT')).toBe(listeners);
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

  test('points Droid at a runtime settings file that turns every sound off and logs its sessions', async () => {
    const file = launchEnv()['FACTORY_RUNTIME_SETTINGS_PATH'];
    expect(file).toBe(PROBE_SETTINGS_FILE);
    const written: unknown = await Bun.file(PROBE_SETTINGS_FILE).json();
    expect(written).toEqual(PROBE_SETTINGS);
    expect(PROBE_SETTINGS).toMatchObject({ completionSound: 'off', awaitingInputSound: 'off' });
    expect(Object.keys(PROBE_SETTINGS.hooks)).toEqual(['SessionStart', 'SessionEnd']);
  });

  test('lets caller entries win', () => {
    expect(launchEnv({ TERM: 'dumb' })['TERM']).toBe('dumb');
  });
});
