import { describe, expect, test } from 'bun:test';

import { locateGraph, readModules, readRegion, readSource } from '../graph.ts';
import { build, entry, sidecars, text } from './binary.ts';

describe('locateGraph', () => {
  test('round-trips the three regions of the entry record', () => {
    const bytes = build([entry, ...sidecars]);
    const graph = locateGraph(bytes);

    expect(text(readRegion(bytes, graph.source))).toBe(entry.source);
    expect(text(readRegion(bytes, graph.bytecode))).toBe(entry.bytecode ?? '');
    expect(text(readRegion(bytes, graph.moduleInfo))).toBe(entry.moduleInfo ?? '');
  });

  test('reads the entry record even when it is not first', () => {
    const bytes = build([...sidecars, entry], sidecars.length);
    expect(readSource(bytes)).toBe(entry.source);
  });

  test('throws without a Bun trailer', () => {
    expect(() => locateGraph(new Uint8Array(Buffer.from('not a bun binary')))).toThrow(
      'Bun trailer not found',
    );
  });

  test('throws when the module table is not a whole number of records', () => {
    const bytes = build([entry, ...sidecars]);
    const trailerPos = bytes.length - '\n---- Bun! ----\n'.length;
    new DataView(bytes.buffer).setUint32(trailerPos - 32 + 12, 100, true);

    expect(() => locateGraph(bytes)).toThrow('not a multiple of 52');
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

  test('returns nothing when the entry point is the only record', () => {
    expect(readModules(build([entry]))).toEqual([]);
  });
});
