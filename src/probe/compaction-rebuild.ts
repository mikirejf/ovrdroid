import path from 'node:path';

import { say } from '../cli.ts';
import { FACTORY_SESSIONS } from '../paths.ts';
import { parseBodies } from './bodies.ts';
import { rebuildCompactions, sessionRecords } from './compaction-rebuild-report.ts';

const TRANSCRIPT_EXTENSION = '.jsonl';

export interface CompactionRebuildOptions {
  template: string;
  compaction: number[];
  withLastTurn: boolean;
  out?: string;
}

async function transcriptOf(session: string): Promise<string> {
  if (session.endsWith(TRANSCRIPT_EXTENSION) || session.includes(path.sep)) {
    return session;
  }
  const found = await Array.fromAsync(
    new Bun.Glob(`*/${session}*${TRANSCRIPT_EXTENSION}`).scan({
      cwd: FACTORY_SESSIONS,
      absolute: true,
    }),
  );
  const [only, ...others] = found;
  if (only === undefined) {
    throw new Error(`no session transcript matches "${session}" under ${FACTORY_SESSIONS}`);
  }
  if (others.length > 0) {
    throw new Error(`"${session}" matches ${found.length} transcripts: ${found.join(', ')}`);
  }
  return only;
}

export async function compactionRebuild(
  session: string,
  options: CompactionRebuildOptions,
): Promise<void> {
  const file = await transcriptOf(session);
  const rows = rebuildCompactions({
    sessionId: path.basename(file, TRANSCRIPT_EXTENSION),
    records: sessionRecords(await Bun.file(file).text()),
    templates: parseBodies(await Bun.file(options.template).text()),
    compactions: options.compaction,
    keepLastTurn: options.withLastTurn,
  });
  const lines = rows.map((row) => JSON.stringify(row));
  if (options.out === undefined) {
    for (const line of lines) {
      say(line);
    }
    return;
  }
  await Bun.write(options.out, `${lines.join('\n')}\n`);
  process.stderr.write(`wrote ${lines.length} rows to ${options.out}\n`);
}
