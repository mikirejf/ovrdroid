import path from 'node:path';

import { withTempDir } from '../temp.ts';
import { preambleFor, stageEmbeds } from './embeds.ts';

const SOURCE_FILE = 'entry.js';

export interface BuildRequest {
  bun: string;
  source: string;
  stock: Uint8Array;
  out: string;
}

export async function buildBinary({ bun, source, stock, out }: BuildRequest): Promise<number> {
  return await withTempDir('build', async (dir) => {
    const embeds = await stageEmbeds(stock, dir);
    await Bun.write(path.join(dir, SOURCE_FILE), preambleFor(embeds) + source);

    const started = Bun.nanoseconds();
    const build = Bun.spawnSync(
      [
        bun,
        'build',
        '--compile',
        '--bytecode',
        '--format=esm',
        '--minify',
        '--target=bun',
        '--asset-naming=[name].[ext]',
        SOURCE_FILE,
        '--outfile',
        path.resolve(out),
      ],
      { cwd: dir, stdio: ['ignore', 'inherit', 'inherit'] },
    );
    const seconds = (Bun.nanoseconds() - started) / 1e9;

    if (build.exitCode !== 0) {
      throw new Error(`bun build failed with exit code ${build.exitCode}`);
    }

    return seconds;
  });
}
