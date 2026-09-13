import { mkdtempSync, realpathSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

export function makeTempDir(prefix: string): string {
  return realpathSync(mkdtempSync(path.join(tmpdir(), `overdroid-${prefix}-`)));
}

export async function withTempDir<T>(prefix: string, use: (dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(path.join(tmpdir(), `overdroid-${prefix}-`));
  try {
    return await use(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
