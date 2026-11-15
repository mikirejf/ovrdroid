import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { withLiveDir } from './live-session.ts';
import { offeredTypes } from './subagents-setup.ts';

export interface ProjectDroid {
  type: string;
  text: string;
}

export interface Scratch {
  dir: string;
  cwd: string;
}

export function projectDroidsFolder(cwd: string): string {
  return path.join(cwd, '.factory', 'droids');
}

export async function withProjectDroid<T>(
  cwd: string,
  droid: ProjectDroid,
  use: () => Promise<T>,
): Promise<T> {
  const folder = projectDroidsFolder(cwd);
  const file = path.join(folder, `${droid.type}.md`);
  const made = mkdirSync(folder, { recursive: true });
  try {
    writeFileSync(file, droid.text);
    if (!offeredTypes(cwd).includes(droid.type)) {
      throw new Error(`Droid would not offer the project-local droid ${droid.type} in ${folder}`);
    }
    return await use();
  } finally {
    rmSync(made ?? file, { recursive: true, force: true });
  }
}

export async function withScratchProject<T>(
  prefix: string,
  droid: ProjectDroid,
  use: (scratch: Scratch) => Promise<T>,
): Promise<T> {
  return await withLiveDir(prefix, async (dir) => {
    const cwd = path.join(dir, 'work');
    mkdirSync(cwd);
    return await withProjectDroid(cwd, droid, async () => await use({ dir, cwd }));
  });
}
