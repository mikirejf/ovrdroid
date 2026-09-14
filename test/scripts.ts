import { chmodSync } from 'node:fs';
import path from 'node:path';

import { messageOf } from '../src/cli.ts';

export { PAINT_MARKER } from '../src/launch.ts';
export { makeTempDir as scriptDir } from '../src/temp.ts';

export async function script(dir: string, name: string, lines: readonly string[]): Promise<string> {
  const file = path.join(dir, name);
  await Bun.write(file, `#!/bin/sh\n${lines.join('\n')}\n`);
  chmodSync(file, 0o755);
  return file;
}

export async function rejection(work: Promise<unknown>): Promise<string> {
  try {
    await work;
  } catch (error) {
    return messageOf(error);
  }
  throw new Error('expected a rejection');
}
