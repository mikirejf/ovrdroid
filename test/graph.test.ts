import { describe, expect, test } from 'bun:test';

import { locateGraph, readRegion, readSource, transplantInto } from '../src/graph.ts';

const TRAILER = '\n---- Bun! ----\n';
const RECORD_SIZE = 52;

interface Parts {
  name: string;
  source: string;
  bytecode: string;
  moduleInfo: string;
}

function build(parts: Parts, slack = 0): Uint8Array {
  const name = Buffer.from(parts.name);
  const source = Buffer.from(parts.source);
  const bytecode = Buffer.from(parts.bytecode);
  const moduleInfo = Buffer.from(parts.moduleInfo);

  const prefix = Buffer.alloc(64, 0x41);
  const blobs = [name, source, bytecode, moduleInfo];
  const padded = blobs.map((blob) => Buffer.concat([blob, Buffer.alloc(slack)]));

  const starts: number[] = [];
  let cursor = 0;
  for (const blob of padded) {
    starts.push(cursor);
    cursor += blob.length;
  }

  const record = Buffer.alloc(RECORD_SIZE);
  const fields = [
    [starts[0], name.length],
    [starts[1], source.length],
    [0, 0],
    [starts[2], bytecode.length],
    [starts[3], moduleInfo.length],
    [0, 0],
  ];
  for (const [index, [off, len]] of fields.entries()) {
    record.writeUInt32LE(off ?? 0, index * 8);
    record.writeUInt32LE(len ?? 0, index * 8 + 4);
  }

  const body = Buffer.concat([...padded, record]);
  const modulesOff = cursor;
  const byteCount = body.length;

  const offsets = Buffer.alloc(32);
  offsets.writeBigUInt64LE(BigInt(byteCount), 0);
  offsets.writeUInt32LE(modulesOff, 8);
  offsets.writeUInt32LE(RECORD_SIZE, 12);
  offsets.writeUInt32LE(0, 16);

  return new Uint8Array(Buffer.concat([prefix, body, offsets, Buffer.from(TRAILER)]));
}

const stockParts: Parts = {
  name: '/$bunfs/root/index.js',
  source: 'let a=1;',
  bytecode: 'BYTECODE-BLOB',
  moduleInfo: 'MODULE-INFO',
};

const donorParts: Parts = { name: 'r', source: 'x', bytecode: 'y', moduleInfo: 'z' };

function text(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString();
}

function transplant(stock: Uint8Array, rebuilt: Uint8Array): Uint8Array {
  transplantInto(stock, rebuilt);
  return stock;
}

describe('locateGraph', () => {
  test('round-trips the three regions of the entry record', () => {
    const bytes = build(stockParts);
    const graph = locateGraph(bytes);

    expect(text(readRegion(bytes, graph.source))).toBe(stockParts.source);
    expect(text(readRegion(bytes, graph.bytecode))).toBe(stockParts.bytecode);
    expect(text(readRegion(bytes, graph.moduleInfo))).toBe(stockParts.moduleInfo);
  });

  test('readSource decodes the contents region', () => {
    expect(readSource(build(stockParts))).toBe(stockParts.source);
  });

  test('throws without a Bun trailer', () => {
    expect(() => locateGraph(new Uint8Array(Buffer.from('not a bun binary')))).toThrow(
      'Bun trailer not found',
    );
  });
});

describe('transplant', () => {
  test('installs the donor regions and updates the three lengths', () => {
    const stock = build(stockParts, 16);
    const rebuilt = build({
      name: 'rebuilt',
      source: 'let b=2;',
      bytecode: 'NEW-BC',
      moduleInfo: 'NEW-MI',
    });

    const out = transplant(stock, rebuilt);
    const graph = locateGraph(out);

    expect(graph.source.length).toBe(8);
    expect(graph.bytecode.length).toBe(6);
    expect(graph.moduleInfo.length).toBe(6);
    expect(text(readRegion(out, graph.source))).toBe('let b=2;');
    expect(text(readRegion(out, graph.bytecode))).toBe('NEW-BC');
    expect(text(readRegion(out, graph.moduleInfo))).toBe('NEW-MI');
  });

  test('keeps the region offsets where they were', () => {
    const stock = build(stockParts, 16);
    const before = locateGraph(stock);
    const after = locateGraph(transplant(stock, build(donorParts)));

    expect(after.source.start).toBe(before.source.start);
    expect(after.bytecode.start).toBe(before.bytecode.start);
    expect(after.moduleInfo.start).toBe(before.moduleInfo.start);
  });

  test('zero-fills the unused tail of each slot', () => {
    const stock = build(stockParts, 16);
    const slot = locateGraph(stock).source;
    const out = transplant(stock, build(donorParts));

    const tail = out.subarray(slot.start + 1, slot.start + slot.length);
    expect(tail.every((byte) => byte === 0)).toBe(true);
  });

  test('does not change the total size', () => {
    const stock = build(stockParts, 16);
    const before = stock.byteLength;
    expect(transplant(stock, build(donorParts)).byteLength).toBe(before);
  });

  const oversized: [string, Parts][] = [
    ['source', { name: 'r', source: 'far too long to fit', bytecode: 'y', moduleInfo: 'z' }],
    ['bytecode', { name: 'r', source: 'x', bytecode: 'far too long to fit', moduleInfo: 'z' }],
    ['module_info', { name: 'r', source: 'x', bytecode: 'y', moduleInfo: 'far too long to fit' }],
  ];

  test.each(oversized)('throws naming %s when that region does not fit', (region, parts) => {
    expect(() => transplant(build(stockParts), build(parts))).toThrow(
      `rebuilt ${region} does not fit`,
    );
  });
});
