import { readdirSync } from 'node:fs';
import path from 'node:path';

import { hasErrorCode } from '../cli.ts';
import { inPool } from './pool.ts';

const TRANSCRIPTS = '*/*.jsonl';
const STAT_WIDTH = 16;

export interface Transcripts {
  total: number;
  recent: string[];
}

function entriesUnder(dir: string) {
  try {
    return readdirSync(dir, { withFileTypes: true });
  } catch (error) {
    if (hasErrorCode(error, 'ENOENT')) {
      return [];
    }
    throw error;
  }
}

export function* sessionFilesUnder(dir: string): Generator<string, void> {
  for (const folder of entriesUnder(dir)) {
    if (!folder.isDirectory()) {
      continue;
    }
    const directory = path.join(dir, folder.name);
    for (const file of entriesUnder(directory)) {
      if (file.isFile()) {
        yield path.join(directory, file.name);
      }
    }
  }
}

export async function transcriptsSince(dir: string, cutoff: number): Promise<Transcripts> {
  const scanned = await Array.fromAsync(
    new Bun.Glob(TRANSCRIPTS).scan({ cwd: dir, absolute: true }),
  );
  const files = scanned.toSorted();
  const touched = await inPool(files, STAT_WIDTH, async (file) => {
    const info = await Bun.file(file).stat();
    return info.mtimeMs >= cutoff;
  });
  return { total: files.length, recent: files.filter((_, at) => touched[at] === true) };
}
