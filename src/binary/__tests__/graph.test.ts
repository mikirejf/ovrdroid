import { describe, expect, test } from 'bun:test';

import {
  ENCODING_LATIN1,
  LOADER_FILE,
  LOADER_TEXT,
  readApp,
  readModules,
  readRegion,
} from '../graph.ts';
import { build, chunk, entry, ripgrep, sidecars, skillText, text } from './binary.ts';

describe('readApp', () => {
  test('returns the entry module alone when there are no chunks', () => {
    expect(readApp(build([entry, ...sidecars]))).toEqual([
      { name: '/$bunfs/root/index.js', text: 'let a=1;' },
    ]);
  });

  test('puts the entry first even when it sits last in the table', () => {
    const app = readApp(build([...sidecars, entry], sidecars.length));

    expect(app.map((module) => module.name)).toEqual(['/$bunfs/root/index.js']);
  });

  test('keeps the chunks in table order behind the entry', () => {
    const one = chunk('chunk-aaaaaaaa.js', 'let b=2;');
    const two = chunk('chunk-bbbbbbbb.js', 'let c=3;');
    const app = readApp(build([one, entry, two], 1));

    expect(app.map((module) => module.name)).toEqual([
      '/$bunfs/root/index.js',
      '/$bunfs/root/chunk-aaaaaaaa.js',
      '/$bunfs/root/chunk-bbbbbbbb.js',
    ]);
  });

  test('excludes the sidecars', () => {
    const app = readApp(
      build([entry, chunk('chunk-aaaaaaaa.js', 'let b=2;'), ...sidecars, skillText]),
    );

    expect(app.map((module) => module.text)).toEqual(['let a=1;', 'let b=2;']);
  });

  test('throws without a Bun trailer', () => {
    expect(() => readApp(new Uint8Array(Buffer.from('not a bun binary')))).toThrow(
      'Bun trailer not found',
    );
  });

  test('throws when the module table is not a whole number of records', () => {
    const bytes = build([entry, ...sidecars]);
    const trailerPos = bytes.length - '\n---- Bun! ----\n'.length;
    new DataView(bytes.buffer).setUint32(trailerPos - 32 + 12, 100, true);

    expect(() => readApp(bytes)).toThrow('not a multiple of 52');
  });
});

describe('readModules', () => {
  test('returns every embedded file with its stored name', () => {
    const modules = readModules(build([entry, ...sidecars]));

    expect(modules.map((module) => module.name)).toEqual([
      '/$bunfs/root/rg-kc7jt1ak.',
      '/$bunfs/root/SKILL.md-9e33f36r.asset',
    ]);
  });

  test('omits the entry point wherever it sits in the table', () => {
    const names = readModules(build([...sidecars, entry], sidecars.length)).map((m) => m.name);

    expect(names).not.toContain('/$bunfs/root/index.js');
    expect(names).toHaveLength(sidecars.length);
  });

  test('points at the bytes of each embedded file', () => {
    const bytes = build([entry, ...sidecars]);
    const found = readModules(bytes).map((module) => text(readRegion(bytes, module.source)));

    expect(found).toEqual(['RIPGREP-BYTES', '# a skill']);
  });

  test('reads the loader and encoding of each embedded file', () => {
    const modules = readModules(build([entry, ripgrep, skillText]));

    expect(modules.map((module) => [module.loader, module.encoding])).toEqual([
      [LOADER_FILE, 0],
      [LOADER_TEXT, ENCODING_LATIN1],
    ]);
  });

  test('returns nothing when the entry point is the only record', () => {
    expect(readModules(build([entry]))).toEqual([]);
  });
});
