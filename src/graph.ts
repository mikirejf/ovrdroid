const TRAILER = '\n---- Bun! ----\n';
const OFFSETS_SIZE = 32;
const RECORD_SIZE = 52;

const REGION_FIELDS = [
  { key: 'source', label: 'source', offsetField: 8 },
  { key: 'bytecode', label: 'bytecode', offsetField: 24 },
  { key: 'moduleInfo', label: 'module_info', offsetField: 32 },
] as const;

export interface Region {
  start: number;
  length: number;
}

export interface Graph {
  recordPos: number;
  source: Region;
  bytecode: Region;
  moduleInfo: Region;
}

function viewOf(bytes: Uint8Array): DataView {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}

export function bufferOf(bytes: Uint8Array): Buffer {
  return Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}

export function locateGraph(bytes: Uint8Array): Graph {
  const trailerPos = bufferOf(bytes).lastIndexOf(TRAILER);
  if (trailerPos === -1) {
    throw new Error('Bun trailer not found: this is not a Bun standalone binary');
  }

  const view = viewOf(bytes);
  const offsetsPos = trailerPos - OFFSETS_SIZE;
  const byteCount = Number(view.getBigUint64(offsetsPos, true));
  const modulesOff = view.getUint32(offsetsPos + 8, true);
  const entryPointId = view.getUint32(offsetsPos + 16, true);

  const base = offsetsPos - byteCount;
  const recordPos = base + modulesOff + entryPointId * RECORD_SIZE;
  const read = (offsetField: number): Region => ({
    start: base + view.getUint32(recordPos + offsetField, true),
    length: view.getUint32(recordPos + offsetField + 4, true),
  });

  return {
    recordPos,
    source: read(REGION_FIELDS[0].offsetField),
    bytecode: read(REGION_FIELDS[1].offsetField),
    moduleInfo: read(REGION_FIELDS[2].offsetField),
  };
}

export function readRegion(bytes: Uint8Array, area: Region): Uint8Array {
  return bytes.subarray(area.start, area.start + area.length);
}

export function readSource(bytes: Uint8Array, graph = locateGraph(bytes)): string {
  return bufferOf(readRegion(bytes, graph.source)).toString('utf-8');
}

export function transplantInto(binary: Uint8Array, rebuilt: Uint8Array): void {
  const target = locateGraph(binary);
  const donor = locateGraph(rebuilt);

  for (const { key, label } of REGION_FIELDS) {
    if (donor[key].length > target[key].length) {
      throw new Error(
        `rebuilt ${label} does not fit its slot: ${donor[key].length} bytes into ${target[key].length}`,
      );
    }
  }

  const view = viewOf(binary);
  for (const { key, offsetField } of REGION_FIELDS) {
    const slot = target[key];
    binary.fill(0, slot.start, slot.start + slot.length);
    binary.set(readRegion(rebuilt, donor[key]), slot.start);
    view.setUint32(target.recordPos + offsetField + 4, donor[key].length, true);
  }
}
