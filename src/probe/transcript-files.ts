import { inPool } from './pool.ts';

const TRANSCRIPTS = '*/*.jsonl';
const STAT_WIDTH = 16;

export interface Transcripts {
  total: number;
  recent: string[];
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
