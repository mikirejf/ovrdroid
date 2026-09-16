import path from 'node:path';

import type { Module } from './graph.ts';
import {
  bufferOf,
  embedName,
  ENCODING_LATIN1,
  ENCODING_UTF16LE,
  LOADER_FILE,
  LOADER_JS,
  LOADER_TEXT,
  readModules,
  readRegion,
} from './graph.ts';

const ASSET_DIR = 'assets';
const CONTENT_HASH = /-[a-z0-9]{8}(?<ext>\.\w+)$/u;

export interface StagedEmbed {
  specifier: string;
  kind: 'file' | 'text';
}

function importName(index: number): string {
  return `__od${index}`;
}

function embedsOf(bytes: Uint8Array): Map<string, Module> {
  const embeds = new Map<string, Module>();

  for (const module of readModules(bytes)) {
    if (module.loader === LOADER_JS) {
      continue;
    }
    if (embeds.has(module.name)) {
      throw new Error(`two embedded files share the name ${module.name}`);
    }
    embeds.set(module.name, module);
  }

  return embeds;
}

function decodedText(bytes: Uint8Array, module: Module): string {
  const stored = bufferOf(readRegion(bytes, module.source));
  if (module.encoding === ENCODING_LATIN1) {
    return stored.toString('latin1');
  }
  if (module.encoding === ENCODING_UTF16LE) {
    return stored.toString('utf16le');
  }
  throw new Error(`embedded file ${module.name} carries unknown text encoding ${module.encoding}`);
}

export function preambleFor(embeds: readonly StagedEmbed[]): string {
  const lines = embeds.map(
    ({ specifier, kind }, index) =>
      `import ${importName(index)} from ${JSON.stringify(`./${ASSET_DIR}/${specifier}`)} with { type: "${kind}" };`,
  );
  const kept = embeds.map((_, index) => importName(index)).join(',');
  return `${lines.join('\n')}\nglobalThis.__odAssets=[${kept}];\n`;
}

export async function stageEmbeds(stock: Uint8Array, dir: string): Promise<StagedEmbed[]> {
  const staged = [...embedsOf(stock).values()].map((module, index) => {
    if (module.loader === LOADER_FILE) {
      return { specifier: embedName(module.name), kind: 'file' as const, module };
    }
    if (module.loader === LOADER_TEXT) {
      const stem = embedName(module.name).replace(CONTENT_HASH, '$<ext>');
      return { specifier: `${index}/${stem}`, kind: 'text' as const, module };
    }
    throw new Error(`embedded file ${module.name} uses unknown loader ${module.loader}`);
  });

  const collisions = staged
    .map(({ specifier }) => specifier)
    .filter((specifier, index, all) => all.indexOf(specifier) !== index);
  if (collisions.length > 0) {
    throw new Error(`two embedded files stage to the same asset: ${collisions.join(', ')}`);
  }

  await Promise.all(
    staged.map(async ({ specifier, kind, module }) => {
      const body = kind === 'text' ? decodedText(stock, module) : readRegion(stock, module.source);
      await Bun.write(path.join(dir, ASSET_DIR, specifier), body);
    }),
  );

  return staged.map(({ specifier, kind }) => ({ specifier, kind }));
}

export function assertSameEmbeds(stock: Uint8Array, rebuilt: Uint8Array): void {
  const before = embedsOf(stock);
  const after = embedsOf(rebuilt);

  const missing: string[] = [];
  const changed: string[] = [];
  const reloaded: string[] = [];
  const recoded: string[] = [];

  for (const [name, module] of before) {
    const twin = after.get(name);
    if (twin === undefined) {
      missing.push(name);
    } else if (module.loader !== twin.loader) {
      reloaded.push(name);
    } else if (module.encoding !== twin.encoding) {
      recoded.push(name);
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

  if (reloaded.length > 0) {
    throw new Error(`embedded files changed loader: ${reloaded.join(', ')}`);
  }

  if (recoded.length > 0) {
    throw new Error(`embedded files changed text encoding: ${recoded.join(', ')}`);
  }

  if (changed.length > 0) {
    throw new Error(`embedded files changed content: ${changed.join(', ')}`);
  }
}
