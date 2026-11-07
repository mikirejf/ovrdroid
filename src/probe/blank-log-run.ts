import { readFile } from 'node:fs/promises';

import { hasErrorCode, say } from '../cli.ts';
import { BLANK_LOG_FILE } from '../patch/blank-diag-patches.ts';
import { ovrdroidFile } from '../paths.ts';
import { describeBlankLog, parseBlankLog, parseSince } from './blank-log.ts';

export const DEFAULT_BLANK_LOG = ovrdroidFile(BLANK_LOG_FILE);

interface BlankLogOptions {
  file: string;
  since?: string;
}

export async function blankLog(options: BlankLogOptions): Promise<void> {
  let content: string;
  try {
    content = await readFile(options.file, 'utf-8');
  } catch (error) {
    if (hasErrorCode(error, 'ENOENT')) {
      say(
        `No diagnostic log at ${options.file}: no build with the blank-diag patches has written one yet.`,
      );
      return;
    }
    throw error;
  }
  const log = parseBlankLog(content);
  const from = options.since === undefined ? -Infinity : parseSince(options.since, Date.now());
  for (const line of describeBlankLog({ ...log, rows: log.rows.filter((row) => row.at >= from) })) {
    say(line);
  }
}
