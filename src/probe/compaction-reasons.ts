import path from 'node:path';

import { say } from '../cli.ts';
import type { SourcedReply } from './compaction-reasons-report.ts';
import { reasonsReport } from './compaction-reasons-report.ts';
import { readSaved } from './compaction-saved.ts';

export async function compactionReasons(dirs: readonly string[]): Promise<void> {
  const groups = await Promise.all(
    dirs.map(async (dir): Promise<SourcedReply[]> => {
      const replies = await readSaved(dir);
      return replies.map((reply) => ({ source: path.basename(path.resolve(dir)), reply }));
    }),
  );
  for (const line of reasonsReport(groups.flat())) {
    say(line);
  }
}
