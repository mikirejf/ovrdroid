import path from 'node:path';

import { MS_PER_DAY, say } from '../cli.ts';
import { FACTORY_SESSIONS } from '../paths.ts';
import type { SessionReading } from './external.ts';
import { describeExternal, readExternal, summariseExternal } from './external.ts';
import { inPool } from './pool.ts';
import { transcriptsSince } from './transcript-files.ts';

export const DEFAULT_SESSIONS = FACTORY_SESSIONS;
export const DEFAULT_SINCE_DAYS = 30;

const READ_WIDTH = 8;

export interface ExternalOptions {
  since: number;
  sessions: string;
  json: boolean;
}

async function readTranscript(file: string): Promise<SessionReading> {
  const text = await Bun.file(file).text();
  return {
    session: path.basename(file, '.jsonl'),
    reading: readExternal(text.split('\n')),
  };
}

export async function external(options: ExternalOptions): Promise<void> {
  const { recent } = await transcriptsSince(
    options.sessions,
    Date.now() - options.since * MS_PER_DAY,
  );
  const readings = await inPool(recent, READ_WIDTH, readTranscript);
  const summary = summariseExternal(readings);
  if (options.json) {
    say(JSON.stringify(summary, undefined, 2));
    return;
  }
  say(`${options.sessions}: ${recent.length} transcripts from the last ${options.since} days`);
  say('');
  say(describeExternal(summary));
}
