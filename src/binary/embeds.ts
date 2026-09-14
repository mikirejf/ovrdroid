import path from 'node:path';

import type { Module } from './graph.ts';
import { bufferOf, readModules, readRegion } from './graph.ts';

const EMBED_PREFIX = '/$bunfs/root/';
const ASSET_DIR = 'assets';

function importName(index: number): string {
  return `__od${index}`;
}

function assetNameOf(module: Module): string {
  return module.name.startsWith(EMBED_PREFIX)
    ? module.name.slice(EMBED_PREFIX.length)
    : module.name;
}

function embedsOf(bytes: Uint8Array): Map<string, Module> {
  const embeds = new Map<string, Module>();

  for (const module of readModules(bytes)) {
    if (embeds.has(module.name)) {
      throw new Error(`two embedded files share the name ${module.name}`);
    }
    embeds.set(module.name, module);
  }

  return embeds;
}

export function preambleFor(names: readonly string[]): string {
  const lines = names.map(
    (name, index) =>
      `import ${importName(index)} from ${JSON.stringify(`./${ASSET_DIR}/${name}`)} with { type: "file" };`,
  );
  const kept = names.map((_, index) => importName(index)).join(',');
  return `${lines.join('\n')}\nglobalThis.__odAssets=[${kept}];\n`;
}

export async function stageEmbeds(stock: Uint8Array, dir: string): Promise<string[]> {
  const staged = [...embedsOf(stock).values()].map((module) => ({
    asset: assetNameOf(module),
    module,
  }));

  const collisions = staged
    .map(({ asset }) => asset)
    .filter((asset, index, all) => all.indexOf(asset) !== index);
  if (collisions.length > 0) {
    throw new Error(`two embedded files stage to the same asset: ${collisions.join(', ')}`);
  }

  await Promise.all(
    staged.map(
      async ({ asset, module }) =>
        await Bun.write(path.join(dir, ASSET_DIR, asset), readRegion(stock, module.source)),
    ),
  );

  return staged.map(({ asset }) => asset);
}

export function assertSameEmbeds(stock: Uint8Array, rebuilt: Uint8Array): void {
  const before = embedsOf(stock);
  const after = embedsOf(rebuilt);

  const missing: string[] = [];
  const changed: string[] = [];

  for (const [name, module] of before) {
    const twin = after.get(name);
    if (twin === undefined) {
      missing.push(name);
    } else if (
      !bufferOf(readRegion(stock, module.source)).equals(readRegion(rebuilt, twin.source))
    ) {
      changed.push(name);
    }
  }
  if (missing.length > 0) {
    throw new Error(`rebuilt binary is missing embedded files: ${missing.join(', ')}`);
  }

  const extra = [...after.keys()].filter((name) => !before.has(name));
  if (extra.length > 0) {
    throw new Error(`rebuilt binary carries unexpected embedded files: ${extra.join(', ')}`);
  }

  if (changed.length > 0) {
    throw new Error(`embedded files changed content: ${changed.join(', ')}`);
  }
}
