const TRAILER = '\n---- Bun! ----\n';
const OFFSETS_SIZE = 32;
const RECORD_SIZE = 52;

const HEADER = { byteCount: 0, modulesOff: 8, modulesSize: 12, entryPointId: 16 } as const;
const FIELD = {
  name: 0,
  source: 8,
  bytecode: 24,
  moduleInfo: 32,
  encoding: 48,
  loader: 49,
} as const;

export const LOADER_JS = 1;
export const LOADER_FILE = 5;
export const LOADER_TEXT = 13;

export const ENCODING_LATIN1 = 1;
export const ENCODING_UTF16LE = 2;

export const EMBED_PREFIX = '/$bunfs/root/';
export const ENTRY_FILE = 'entry.js';

export interface Region {
  start: number;
  length: number;
}

export interface AppModule {
  name: string;
  text: string;
}

export type App = readonly [AppModule, ...AppModule[]];

export function embedName(name: string): string {
  return name.startsWith(EMBED_PREFIX) ? name.slice(EMBED_PREFIX.length) : name;
}

export function appBytes(app: App): number {
  return app.reduce((sum, module) => sum + module.text.length, 0);
}

export function joinApp(app: App): string {
  return app.map((module) => module.text).join('\n');
}

export interface Module {
  name: string;
  source: Region;
  loader: number;
  encoding: number;
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
      loader: layout.view.getUint8(recordPos + FIELD.loader),
      encoding: layout.view.getUint8(recordPos + FIELD.encoding),
    });
  }

  return modules;
}

function readAppModule(bytes: Uint8Array, layout: Layout, recordPos: number): AppModule {
  const name = readText(bytes, regionAt(layout, recordPos, FIELD.name));
  const encoding = layout.view.getUint8(recordPos + FIELD.encoding);
  if (encoding !== ENCODING_LATIN1) {
    throw new Error(`app module ${name} carries unexpected text encoding ${encoding}`);
  }
  return {
    name,
    text: bufferOf(readRegion(bytes, regionAt(layout, recordPos, FIELD.source))).toString('latin1'),
  };
}

export function readApp(bytes: Uint8Array): App {
  const layout = layoutOf(bytes);
  let entry: AppModule | undefined;
  const chunks: AppModule[] = [];

  for (let index = 0; index < layout.recordCount; index += 1) {
    const recordPos = recordPosOf(layout, index);
    const isEntry = index === layout.entryPointId;
    if (!isEntry && layout.view.getUint8(recordPos + FIELD.loader) !== LOADER_JS) {
      continue;
    }
    const module = readAppModule(bytes, layout, recordPos);
    if (isEntry) {
      entry = module;
    } else {
      chunks.push(module);
    }
  }

  if (entry === undefined) {
    throw new Error('binary has no entry module');
  }

  return [entry, ...chunks];
}
