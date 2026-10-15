import path from 'node:path';

import { InvalidArgumentError } from 'commander';

import { say } from '../cli.ts';
import { FACTORY_SESSIONS, ovrdroidFile } from '../paths.ts';
import type { CompactionRecord } from './summaries-report.ts';
import { compactionsOf, parseCompactRow, summariesReport } from './summaries-report.ts';

export const DEFAULT_SUMMARIES_SESSIONS = FACTORY_SESSIONS;
export const DEFAULT_SUMMARIES_USAGE = ovrdroidFile('cache-usage.jsonl');

const TRANSCRIPTS = '*/*.jsonl';
const TRANSCRIPT_EXTENSION = '.jsonl';

export interface SummariesOptions {
  sessions: string;
  usage: string;
  since?: number;
}

export function sinceDate(raw: string): number {
  const at = Date.parse(raw);
  if (Number.isNaN(at)) {
    throw new InvalidArgumentError('expected a date, such as 2026-10-11');
  }
  return at;
}

async function compactionsIn(file: string, since: number): Promise<CompactionRecord[]> {
  const handle = Bun.file(file);
  const info = await handle.stat();
  if (info.mtimeMs < since) {
    return [];
  }
  return compactionsOf(path.basename(file, TRANSCRIPT_EXTENSION), await handle.text(), since);
}

async function readCompactions(dir: string, since: number): Promise<CompactionRecord[]> {
  const files = await Array.fromAsync(new Bun.Glob(TRANSCRIPTS).scan({ cwd: dir, absolute: true }));
  const records = await Promise.all(files.map(async (file) => await compactionsIn(file, since)));
  return records.flat();
}

async function readCompactRows(file: string) {
  const text = await Bun.file(file).text();
  return text
    .split('\n')
    .map((line) => parseCompactRow(line))
    .filter((row) => row !== undefined);
}

export async function summaries(options: SummariesOptions): Promise<void> {
  const since = options.since ?? Number.NEGATIVE_INFINITY;
  const [compactions, rows] = await Promise.all([
    readCompactions(options.sessions, since),
    readCompactRows(options.usage),
  ]);
  for (const line of summariesReport(compactions, rows)) {
    say(line);
  }
}
