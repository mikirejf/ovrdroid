import path from 'node:path';

import type { Command } from 'commander';
import { InvalidArgumentError } from 'commander';

import { say } from '../cli.ts';
import { FACTORY_SESSIONS, ovrdroidFile } from '../paths.ts';
import type { ResumeMarker, UsageRow } from './reopens.ts';
import { findReopens, parseUsageLine, resumeMarkersOf, summariseReopens } from './reopens.ts';

const DEFAULT_USAGE_FILE = ovrdroidFile('cache-usage.jsonl');
const DEFAULT_TIME_ZONE = Intl.DateTimeFormat().resolvedOptions().timeZone;
const TRANSCRIPT_GLOB = '*/*.jsonl';
const TRANSCRIPT_EXTENSION = '.jsonl';
const DAY_PATTERN = /^\d{4}-\d{2}-\d{2}$/u;

export interface ReopensOptions {
  usage: string;
  sessions: string;
  since?: number;
  timeZone: string;
}

function zoneName(raw: string): string {
  try {
    return new Intl.DateTimeFormat('en-CA', { timeZone: raw }).resolvedOptions().timeZone;
  } catch {
    throw new InvalidArgumentError('expected an IANA time zone, such as Europe/Ljubljana');
  }
}

function sinceDay(raw: string): number {
  const at = Date.parse(raw);
  if (!DAY_PATTERN.test(raw) || Number.isNaN(at)) {
    throw new InvalidArgumentError('expected a day as YYYY-MM-DD');
  }
  return at;
}

export function reopensOptions(command: Command): Command {
  return command
    .option('--usage <file>', 'per-request cache usage log', DEFAULT_USAGE_FILE)
    .option('--sessions <dir>', 'Droid session transcripts', FACTORY_SESSIONS)
    .option('--since <day>', 'only reopens on or after this day, YYYY-MM-DD', sinceDay)
    .option(
      '--time-zone <iana>',
      'zone whose midnight splits days, as the proxy counts them',
      zoneName,
      DEFAULT_TIME_ZONE,
    );
}

async function readUsage(file: string): Promise<UsageRow[]> {
  const text = await Bun.file(file).text();
  return text
    .split('\n')
    .map((line) => parseUsageLine(line))
    .filter((row) => row !== undefined);
}

async function readMarkers(dir: string): Promise<ResumeMarker[]> {
  const markers: ResumeMarker[] = [];
  for await (const file of new Bun.Glob(TRANSCRIPT_GLOB).scan({ cwd: dir, absolute: true })) {
    const sessionId = path.basename(file, TRANSCRIPT_EXTENSION);
    markers.push(...resumeMarkersOf(sessionId, file, await Bun.file(file).text()));
  }
  return markers;
}

export async function reopens(options: ReopensOptions): Promise<void> {
  const [usage, markers] = await Promise.all([
    readUsage(options.usage),
    readMarkers(options.sessions),
  ]);
  const since = options.since ?? Number.NEGATIVE_INFINITY;
  const found = findReopens(usage, markers, options.timeZone).filter(
    (reopen) => reopen.marker.at >= since,
  );
  say(summariseReopens(found, options.timeZone));
}
