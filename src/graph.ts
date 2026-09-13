const TRAILER = '\n---- Bun! ----\n';
const OFFSETS_SIZE = 32;
const RECORD_SIZE = 52;

const HEADER = { byteCount: 0, modulesOff: 8, modulesSize: 12, entryPointId: 16 } as const;
const FIELD = { name: 0, source: 8, bytecode: 24, moduleInfo: 32 } as const;

export interface Region {
  start: number;
  length: number;
}

export interface Graph {
  source: Region;
  bytecode: Region;
  moduleInfo: Region;
}

export interface Module {
  name: string;
  source: Region;
}

interface Layout {
  view: DataView;
  base: number;
  modulesOff: number;
  recordCount: number;
  entryPointId: number;
}

function viewOf(bytes: Uint8Array): DataView {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}

export function bufferOf(bytes: Uint8Array): Buffer {
  return Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}

function layoutOf(bytes: Uint8Array): Layout {
  const trailerPos = bufferOf(bytes).lastIndexOf(TRAILER);
  if (trailerPos === -1) {
    throw new Error('Bun trailer not found: this is not a Bun standalone binary');
  }

  const view = viewOf(bytes);
  const offsetsPos = trailerPos - OFFSETS_SIZE;
  const byteCount = Number(view.getBigUint64(offsetsPos + HEADER.byteCount, true));
  const modulesSize = view.getUint32(offsetsPos + HEADER.modulesSize, true);
  if (modulesSize % RECORD_SIZE !== 0) {
    throw new Error(`module table is ${modulesSize} bytes, not a multiple of ${RECORD_SIZE}`);
  }

  return {
    view,
    base: offsetsPos - byteCount,
    modulesOff: view.getUint32(offsetsPos + HEADER.modulesOff, true),
    recordCount: modulesSize / RECORD_SIZE,
    entryPointId: view.getUint32(offsetsPos + HEADER.entryPointId, true),
  };
}

function recordPosOf(layout: Layout, index: number): number {
  return layout.base + layout.modulesOff + index * RECORD_SIZE;
}

function regionAt(layout: Layout, recordPos: number, field: number): Region {
  return {
    start: layout.base + layout.view.getUint32(recordPos + field, true),
    length: layout.view.getUint32(recordPos + field + 4, true),
  };
}

export function locateGraph(bytes: Uint8Array): Graph {
  const layout = layoutOf(bytes);
  const recordPos = recordPosOf(layout, layout.entryPointId);

  return {
    source: regionAt(layout, recordPos, FIELD.source),
    bytecode: regionAt(layout, recordPos, FIELD.bytecode),
    moduleInfo: regionAt(layout, recordPos, FIELD.moduleInfo),
  };
}

export function readRegion(bytes: Uint8Array, area: Region): Uint8Array {
  return bytes.subarray(area.start, area.start + area.length);
}

function readText(bytes: Uint8Array, area: Region): string {
  return bufferOf(readRegion(bytes, area)).toString('utf-8');
}

export function readModules(bytes: Uint8Array): Module[] {
  const layout = layoutOf(bytes);
  const modules: Module[] = [];

  for (let index = 0; index < layout.recordCount; index += 1) {
    if (index === layout.entryPointId) {
      continue;
    }
    const recordPos = recordPosOf(layout, index);
    modules.push({
      name: readText(bytes, regionAt(layout, recordPos, FIELD.name)),
      source: regionAt(layout, recordPos, FIELD.source),
    });
  }

  return modules;
}

export function readSource(bytes: Uint8Array, graph = locateGraph(bytes)): string {
  return readText(bytes, graph.source);
}
