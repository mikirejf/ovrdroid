import { copyFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';

import { FACTORY_HOOKS, FACTORY_SOUNDS, SUBAGENT_SOUND_FILE } from '../paths.ts';

export interface InstalledHook {
  name: string;
  path: string;
  bytes: number;
}

const ENTRIES = [
  { entry: 'hook-execute.ts', name: 'ovrdroid-execute.js' },
  { entry: 'hook-notify.ts', name: 'ovrdroid-notify.js' },
] as const;

export function installSubagentSound(): string {
  const destination = path.join(FACTORY_SOUNDS, SUBAGENT_SOUND_FILE);
  mkdirSync(FACTORY_SOUNDS, { recursive: true });
  copyFileSync(path.join(import.meta.dir, '..', 'sounds', SUBAGENT_SOUND_FILE), destination);
  return destination;
}

function bundledName(entry: string): string {
  return entry.replace(/\.ts$/u, '.js');
}

export async function installHooks(
  into: string = FACTORY_HOOKS,
): Promise<readonly InstalledHook[]> {
  mkdirSync(into, { recursive: true });

  const result = await Bun.build({
    entrypoints: ENTRIES.map(({ entry }) => path.join(import.meta.dir, entry)),
    target: 'bun',
    minify: true,
  });
  if (!result.success) {
    throw new Error(`failed to bundle hooks: ${result.logs.map((log) => log.message).join(', ')}`);
  }

  const built = new Map(result.outputs.map((output) => [path.basename(output.path), output]));

  return await Promise.all(
    ENTRIES.map(async ({ entry, name }) => {
      const output = built.get(bundledName(entry));
      if (output === undefined) {
        throw new Error(`failed to bundle ${entry}: no artifact produced`);
      }

      const destination = path.join(into, name);
      return { name, path: destination, bytes: await Bun.write(destination, output) };
    }),
  );
}
