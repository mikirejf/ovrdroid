import { describe, expect, test } from 'bun:test';

import type { App } from '../graph.ts';
import { assertRefsResolve } from '../refs.ts';

function app(...texts: string[]): App {
  const [head, ...rest] = texts.map((text, index) => ({ name: `/$bunfs/root/m${index}.js`, text }));
  if (head === undefined) {
    throw new Error('the test app needs an entry');
  }
  return [head, ...rest];
}

const embedded = new Set(['rg-kc7jt1ak.', 'chunk-aaaaaaaa.js']);

describe('assertRefsResolve', () => {
  test('accepts an app whose literals all name embedded files', () => {
    expect(() => {
      assertRefsResolve(
        app(
          'var B="/$bunfs/root/rg-kc7jt1ak.";',
          'import.meta.require("/$bunfs/root/chunk-aaaaaaaa.js")',
        ),
        embedded,
      );
    }).not.toThrow();
  });

  test('rejects a lazy require left pointing at a relative path', () => {
    expect(() => {
      assertRefsResolve(app('import.meta.require("./chunk-rtvffc3p.js")'), embedded);
    }).toThrow(
      'requires files by relative path, which never resolve inside the binary: ./chunk-rtvffc3p.js',
    );
  });

  test('rejects a literal naming a file the binary does not carry', () => {
    expect(() => {
      assertRefsResolve(app('var B="/$bunfs/root/rg-gone.";'), embedded);
    }).toThrow('addresses embedded files the binary does not carry: /$bunfs/root/rg-gone.');
  });

  test('names each missing target once across every module', () => {
    expect(() => {
      assertRefsResolve(
        app(
          'import.meta.require("./x.js")',
          'import.meta.require("./x.js");import.meta.require("./y.js")',
        ),
        embedded,
      );
    }).toThrow(': ./x.js, ./y.js');
  });

  test('ignores relative paths outside a lazy require', () => {
    expect(() => {
      assertRefsResolve(app('import a from"./chunk-aaaaaaaa.js";var p="./lib/main.js";'), embedded);
    }).not.toThrow();
  });
});
