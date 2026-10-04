import { InvalidArgumentError } from 'commander';

import { say } from '../cli.ts';
import type { SessionsReading } from './sessions.ts';
import { describeSessions, timeSessionsList } from './sessions.ts';

export interface SessionsReportOptions {
  runs: number;
  opens: number;
  wait: number;
  cwd: string;
}

export function waitMs(raw: string): number {
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new InvalidArgumentError('expected a whole number of milliseconds, 0 or more');
  }
  return parsed;
}

export async function sessions(binary: string, options: SessionsReportOptions): Promise<void> {
  const runs: SessionsReading[][] = [];
  for (let run = 0; run < options.runs; run += 1) {
    // oxlint-disable-next-line no-await-in-loop
    runs.push(await timeSessionsList(binary, { ...options, waitMs: options.wait }));
  }
  say(describeSessions(runs));
  if (runs.flat().some((reading) => reading.shownMs === undefined)) {
    process.exitCode = 1;
  }
}
