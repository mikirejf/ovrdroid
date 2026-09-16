import { describe, expect, test } from 'bun:test';

import { rewriteImports } from '../build.ts';
import type { App } from '../graph.ts';

function app(...parts: [name: string, text: string][]): App {
  const [head, ...rest] = parts.map(([name, text]) => ({ name: `/$bunfs/root/${name}`, text }));
  if (head === undefined) {
    throw new Error('the test app needs an entry');
  }
  return [head, ...rest];
}

describe('rewriteImports', () => {
  test('points a static import at the chunk staged beside the entry', () => {
    const modules = app(
      ['droid', 'import a from"/$bunfs/root/chunk-aaaaaaaa.js";'],
      ['chunk-aaaaaaaa.js', ''],
    );

    expect(rewriteImports(modules)[0].text).toBe('import a from"./chunk-aaaaaaaa.js";');
  });

  test('rewrites a dynamic import inside a chunk too', () => {
    const modules = app(
      ['droid', ''],
      ['chunk-aaaaaaaa.js', 'await import("/$bunfs/root/chunk-bbbbbbbb.js")'],
      ['chunk-bbbbbbbb.js', ''],
    );

    expect(rewriteImports(modules)[1]?.text).toBe('await import("./chunk-bbbbbbbb.js")');
  });

  test('turns a lazy require into one Bun bundles, so the chunk survives the rebuild', () => {
    const modules = app(
      ['droid', ''],
      [
        'chunk-aaaaaaaa.js',
        'let{default:M}=import.meta.require("/$bunfs/root/chunk-bbbbbbbb.js");',
      ],
      ['chunk-bbbbbbbb.js', ''],
    );

    expect(rewriteImports(modules)[1]?.text).toBe('let{default:M}=require("./chunk-bbbbbbbb.js");');
  });

  test('points an import of the entry at the file the entry is staged as', () => {
    const modules = app(['droid', ''], ['chunk-aaaaaaaa.js', 'await import("/$bunfs/root/droid")']);

    expect(rewriteImports(modules)[1]?.text).toBe('await import("./entry.js")');
  });

  test('leaves sidecar paths alone because the app addresses them by literal', () => {
    const modules = app(['droid', 'var B="/$bunfs/root/rg-kc7jt1ak.";'], ['chunk-aaaaaaaa.js', '']);

    expect(rewriteImports(modules)[0].text).toBe('var B="/$bunfs/root/rg-kc7jt1ak.";');
  });

  test('returns the modules unchanged when there are no chunks', () => {
    const modules = app(['droid', 'let a=1;']);

    expect(rewriteImports(modules)).toEqual(modules);
  });

  test('refuses two chunks that would stage to the same file', () => {
    const modules = app(['droid', ''], ['chunk-a.js', ''], ['chunk-a.js', '']);

    expect(() => rewriteImports(modules)).toThrow('app modules stage to the same file: chunk-a.js');
  });

  test('refuses a chunk that would overwrite the staged entry', () => {
    const modules = app(['droid', ''], ['entry.js', '']);

    expect(() => rewriteImports(modules)).toThrow('app modules stage to the same file: entry.js');
  });
});
