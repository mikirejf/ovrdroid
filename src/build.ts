import path from 'node:path';

import { withTempDir } from './temp.ts';

export interface BuildResult {
  bytes: Uint8Array;
  seconds: number;
}

export async function buildBinary(bun: string, source: string): Promise<BuildResult> {
  return await withTempDir('build', async (dir) => {
    await Bun.write(path.join(dir, 'index.js'), source);

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
        'index.js',
        '--outfile',
        'rebuilt',
      ],
      { cwd: dir, stdio: ['ignore', 'inherit', 'inherit'] },
    );
    const seconds = (Bun.nanoseconds() - started) / 1e9;

    if (build.exitCode !== 0) {
      throw new Error(`bun build failed with exit code ${build.exitCode}`);
    }

    return { bytes: await Bun.file(path.join(dir, 'rebuilt')).bytes(), seconds };
  });
}
