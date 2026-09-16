const TRAILER = '\n---- Bun! ----\n';
const RECORD_SIZE = 52;

export interface Parts {
  name: string;
  source: string;
  bytecode?: string;
  moduleInfo?: string;
  loader?: number;
  encoding?: number;
}

const LOADER_JS = 1;
const LOADER_FILE = 5;
const LOADER_TEXT = 13;
const ENCODING_LATIN1 = 1;

export function build(modules: readonly Parts[], entryPointId = 0): Uint8Array {
  const prefix = Buffer.alloc(64, 0x41);
  const blobs: Buffer[] = [];
  const records: Buffer[] = [];
  let cursor = 0;

  const place = (value: string): [number, number] => {
    const blob = Buffer.from(value);
    const start = cursor;
    blobs.push(blob);
    cursor += blob.length;
    return [start, blob.length];
  };

  for (const parts of modules) {
    const name = place(parts.name);
    const source = place(parts.source);
    const bytecode = place(parts.bytecode ?? '');
    const moduleInfo = place(parts.moduleInfo ?? '');

    const record = Buffer.alloc(RECORD_SIZE);
    const fields = [name, source, [0, 0], bytecode, moduleInfo, [0, 0]];
    for (const [index, [off, len]] of fields.entries()) {
      record.writeUInt32LE(off ?? 0, index * 8);
      record.writeUInt32LE(len ?? 0, index * 8 + 4);
    }
    record.writeUInt8(parts.encoding ?? 0, 48);
    record.writeUInt8(parts.loader ?? LOADER_FILE, 49);
    records.push(record);
  }

  const modulesOff = cursor;
  const body = Buffer.concat([...blobs, ...records]);

  const offsets = Buffer.alloc(32);
  offsets.writeBigUInt64LE(BigInt(body.length), 0);
  offsets.writeUInt32LE(modulesOff, 8);
  offsets.writeUInt32LE(records.length * RECORD_SIZE, 12);
  offsets.writeUInt32LE(entryPointId, 16);

  return new Uint8Array(Buffer.concat([prefix, body, offsets, Buffer.from(TRAILER)]));
}

export const entry: Parts = {
  name: '/$bunfs/root/index.js',
  source: 'let a=1;',
  bytecode: 'BYTECODE-BLOB',
  moduleInfo: 'MODULE-INFO',
  loader: LOADER_JS,
  encoding: ENCODING_LATIN1,
};

export function chunk(name: string, source: string): Parts {
  return { name: `/$bunfs/root/${name}`, source, loader: LOADER_JS, encoding: ENCODING_LATIN1 };
}

export const ripgrep: Parts = { name: '/$bunfs/root/rg-kc7jt1ak.', source: 'RIPGREP-BYTES' };
export const skill: Parts = { name: '/$bunfs/root/SKILL.md-9e33f36r.asset', source: '# a skill' };
export const sidecars: Parts[] = [ripgrep, skill];

export const skillText: Parts = {
  name: '/$bunfs/root/SKILL-byzgh4q6.md',
  source: '# a text skill',
  loader: LOADER_TEXT,
  encoding: ENCODING_LATIN1,
};

export function text(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('utf-8');
}
