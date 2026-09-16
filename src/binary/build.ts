import path from 'node:path';

import { withTempDir } from '../temp.ts';
import { preambleFor, stageEmbeds } from './embeds.ts';
import type { App } from './graph.ts';
import { embedName, EMBED_PREFIX, ENTRY_FILE } from './graph.ts';

export interface BuildRequest {
  bun: string;
  app: App;
  stock: Uint8Array;
  out: string;
}

const EMBED_LITERAL = new RegExp(`"${EMBED_PREFIX.replaceAll('$', '\\$')}([^"]+)"`, 'gu');

function stagedNames(app: App): Map<string, string> {
  const [entry, ...chunks] = app;
  const names = new Map<string, string>([[embedName(entry.name), ENTRY_FILE]]);

  for (const chunk of chunks) {
    const staged = embedName(chunk.name);
    if (staged === ENTRY_FILE || names.has(staged)) {
      throw new Error(`app modules stage to the same file: ${staged}`);
    }
    names.set(staged, staged);
  }

  return names;
}

export function rewriteImports(app: App): App {
  const names = stagedNames(app);
  const [entry, ...chunks] = app.map((module) => ({
    name: module.name,
    text: module.text.replace(EMBED_LITERAL, (literal, name: string) => {
      const staged = names.get(name);
      return staged === undefined ? literal : `"./${staged}"`;
    }),
  }));

  if (entry === undefined) {
    throw new Error('binary has no entry module');
  }

  return [entry, ...chunks];
}

export async function buildBinary({ bun, app, stock, out }: BuildRequest): Promise<number> {
  return await withTempDir('build', async (dir) => {
    const embeds = await stageEmbeds(stock, dir);
    const [entry, ...chunks] = rewriteImports(app);

    await Bun.write(path.join(dir, ENTRY_FILE), preambleFor(embeds) + entry.text);
    await Promise.all(
      chunks.map(
        async (chunk) => await Bun.write(path.join(dir, embedName(chunk.name)), chunk.text),
      ),
    );

    const started = Bun.nanoseconds();
    const build = Bun.spawnSync(
      [
        bun,
        'build',
        '--compile',
        '--bytecode',
        '--splitting',
        '--format=esm',
        '--minify',
        '--target=bun',
        '--asset-naming=[name].[ext]',
        ENTRY_FILE,
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
