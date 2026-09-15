import { describe, expect, test } from 'bun:test';
import path from 'node:path';

import { withTempDir } from '../../temp.ts';
import type { InstalledHook } from '../hooks.ts';
import { installHooks } from '../hooks.ts';

function hookNamed(installed: readonly InstalledHook[], name: string): InstalledHook {
  const hook = installed.find((candidate) => candidate.name === name);
  if (hook === undefined) {
    throw new Error(`no hook installed named ${name}`);
  }
  return hook;
}

async function runHook(file: string, payload: unknown): Promise<{ code: number; stdout: string }> {
  const child = Bun.spawn(['bun', file], {
    stdin: new TextEncoder().encode(JSON.stringify(payload)),
    stdout: 'pipe',
    stderr: 'pipe',
  });
  const stdout = await new Response(child.stdout).text();
  return { code: await child.exited, stdout };
}

describe('installHooks', () => {
  test('returns both hooks with non-zero sizes', async () => {
    await withTempDir('hooks', async (dir) => {
      const installed = await installHooks(dir);

      expect(installed.map((hook) => hook.name)).toEqual([
        'ovrdroid-execute.js',
        'ovrdroid-notify.js',
      ]);
      for (const hook of installed) {
        expect(hook.bytes).toBeGreaterThan(0);
      }
    });
  });

  test('writes every hook to disk at the reported size', async () => {
    await withTempDir('hooks', async (dir) => {
      const installed = await installHooks(dir);
      const found = await Promise.all(
        installed.map(async (hook) => {
          const file = Bun.file(hook.path);
          return { exists: await file.exists(), size: file.size };
        }),
      );

      expect(found).toEqual(installed.map((hook) => ({ exists: true, size: hook.bytes })));
    });
  });

  test('creates the destination directory when it does not exist', async () => {
    await withTempDir('hooks', async (dir) => {
      const into = path.join(dir, 'nested', 'hooks');
      const installed = await installHooks(into);

      expect(installed).toHaveLength(2);
      expect(await Bun.file(path.join(into, 'ovrdroid-execute.js')).exists()).toBe(true);
    });
  });

  test('the bundled execute hook allows a real delete', async () => {
    await withTempDir('hooks', async (dir) => {
      const execute = hookNamed(await installHooks(dir), 'ovrdroid-execute.js');
      const victim = path.join(dir, 'victim.txt');
      await Bun.write(victim, 'gone soon');

      const { stdout } = await runHook(execute.path, {
        cwd: dir,
        tool_input: { command: `rm -f ${victim}` },
      });

      const verdict: unknown = JSON.parse(stdout);
      expect(verdict).toMatchObject({ hookSpecificOutput: { permissionDecision: 'allow' } });
    });
  });

  test('the bundled notify hook stays silent on other notifications', async () => {
    await withTempDir('hooks', async (dir) => {
      const notify = hookNamed(await installHooks(dir), 'ovrdroid-notify.js');

      const { code, stdout } = await runHook(notify.path, { notification_type: 'agent_done' });

      expect(code).toBe(0);
      expect(stdout).toBe('');
    });
  });
});
