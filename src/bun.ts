import { chmodSync } from 'node:fs';
import { mkdir, rm } from 'node:fs/promises';
import path from 'node:path';

import { extract, fetchArchive } from './download.ts';
import { bufferOf } from './graph.ts';
import { cacheDir } from './paths.ts';

const VERSION_NEEDLE = 'Bun v';
const VERSION_PATTERN = /^Bun v(?<version>\d+\.\d+\.\d+)/u;
const ASSET = 'bun-darwin-aarch64';

export const BUILD_BUN_VERSION = '1.4.2';

export function embeddedBunVersion(bytes: Uint8Array): string {
  const buffer = bufferOf(bytes);
  for (let from = 0; ;) {
    const at = buffer.indexOf(VERSION_NEEDLE, from);
    if (at === -1) {
      throw new Error('embedded Bun version not found in target');
    }
    const version = VERSION_PATTERN.exec(buffer.toString('latin1', at, at + 20))?.groups?.[
      'version'
    ];
    if (version !== undefined) {
      return version;
    }
    from = at + VERSION_NEEDLE.length;
  }
}

export function reportedVersion(binary: string): string {
  try {
    const result = Bun.spawnSync([binary, '--version']);
    return result.exitCode === 0 ? result.stdout.toString().trim() : '';
  } catch {
    return '';
  }
}

function cachedBunPath(version: string): string {
  return cacheDir(`bun-${version}`, 'bun');
}

async function download(version: string, into: string): Promise<void> {
  const zip = await fetchArchive(
    `https://github.com/oven-sh/bun/releases/download/bun-v${version}/${ASSET}.zip`,
    into,
  );
  await extract(['unzip', '-q', '-o', zip, '-d', into]);
}

export async function ensureBun(version: string): Promise<string> {
  const bun = cachedBunPath(version);
  if (reportedVersion(bun) === version) {
    return bun;
  }

  const dir = path.dirname(bun);
  await rm(dir, { recursive: true, force: true });
  await mkdir(dir, { recursive: true });
  await download(version, dir);

  const unpacked = path.join(dir, ASSET, 'bun');
  await Bun.write(Bun.file(bun), Bun.file(unpacked));
  chmodSync(bun, 0o755);
  await rm(path.join(dir, ASSET), { recursive: true, force: true });
  await rm(path.join(dir, `${ASSET}.zip`), { force: true });

  const reported = reportedVersion(bun);
  if (reported !== version) {
    throw new Error(`downloaded Bun reports ${reported || 'nothing'}, expected ${version}`);
  }
  return bun;
}
