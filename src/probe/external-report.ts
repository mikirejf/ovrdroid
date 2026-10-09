import path from 'node:path';

import { say } from '../cli.ts';
import { FACTORY_SESSIONS } from '../paths.ts';
import type { SessionReading } from './external.ts';
import { describeExternal, readExternal, summariseExternal } from './external.ts';

export const DEFAULT_SESSIONS = FACTORY_SESSIONS;
export const DEFAULT_SINCE_DAYS = 30;

const MS_PER_DAY = 86_400_000;
const TRANSCRIPTS = '**/*.jsonl';

export interface ExternalOptions {
  since: number;
  sessions: string;
  json: boolean;
}

async function recentTranscripts(dir: string, sinceDays: number): Promise<string[]> {
  const cutoff = Date.now() - sinceDays * MS_PER_DAY;
  const recent: string[] = [];
  for await (const name of new Bun.Glob(TRANSCRIPTS).scan({ cwd: dir, absolute: true })) {
    const info = await Bun.file(name).stat();
    if (info.mtimeMs >= cutoff) {
      recent.push(name);
    }
  }
  return recent.toSorted();
}

async function readTranscript(file: string): Promise<SessionReading> {
  const text = await Bun.file(file).text();
  return {
    session: path.basename(file, '.jsonl'),
    reading: readExternal(text.split('\n')),
  };
}

export async function external(options: ExternalOptions): Promise<void> {
  const files = await recentTranscripts(options.sessions, options.since);
  const readings = await Promise.all(files.map(async (file) => await readTranscript(file)));
  const summary = summariseExternal(readings);
  if (options.json) {
    say(JSON.stringify(summary, undefined, 2));
    return;
  }
  say(`${options.sessions}: ${files.length} transcripts from the last ${options.since} days`);
  say('');
  say(describeExternal(summary));
}
