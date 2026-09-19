import { mkdir, readdir } from 'node:fs/promises';
import path from 'node:path';

import { say } from '../cli.ts';
import { FACTORY_LOGS, OVRDROID_LOGS } from '../paths.ts';
import type { LogFile, LogRecords } from './logs.ts';
import { parseLog, summariseLogs } from './logs.ts';

export const DEFAULT_LOG_SOURCE = FACTORY_LOGS;
export const DEFAULT_LOG_STORE = OVRDROID_LOGS;

const LIVE_LOG = 'droid-log-single.log';
const MISSING = -1;

export interface LogsOptions {
  from: string;
  to: string;
}

interface Preserved {
  copied: number;
  kept: number;
}

async function logNames(dir: string): Promise<string[]> {
  const found = await readdir(dir).catch((): string[] => []);
  return found.filter((name) => name.startsWith(LIVE_LOG)).toSorted();
}

async function sizeOf(file: string): Promise<number> {
  try {
    const info = await Bun.file(file).stat();
    return info.size;
  } catch {
    return MISSING;
  }
}

async function preserveOne(name: string, options: LogsOptions): Promise<boolean> {
  const source = path.join(options.from, name);
  const target = path.join(options.to, name);
  const [sourceBytes, targetBytes] = await Promise.all([sizeOf(source), sizeOf(target)]);

  if (name !== LIVE_LOG && targetBytes === sourceBytes) {
    return false;
  }
  await Bun.write(target, Bun.file(source));
  return true;
}

async function preserve(options: LogsOptions): Promise<Preserved> {
  await mkdir(options.to, { recursive: true });
  const names = await logNames(options.from);
  const copies = await Promise.all(names.map(async (name) => await preserveOne(name, options)));
  const copied = copies.filter(Boolean).length;
  return { copied, kept: copies.length - copied };
}

export async function readPreservedLogs(
  dir: string,
): Promise<{ records: LogRecords; files: LogFile[] }> {
  const names = await logNames(dir);
  const read = await Promise.all(
    names.map(async (name) => {
      const file = Bun.file(path.join(dir, name));
      const text = await file.text();
      return { file: { name, bytes: text.length }, parsed: parseLog(text) };
    }),
  );

  const records: LogRecords = { usage: [], busts: [] };
  for (const { parsed } of read) {
    records.usage.push(...parsed.usage);
    records.busts.push(...parsed.busts);
  }

  return { records, files: read.map(({ file }) => file) };
}

export async function logs(options: LogsOptions): Promise<void> {
  const { copied, kept } = await preserve(options);
  say(`${options.to}: ${copied} copied, ${kept} already there`);
  say('');

  const { records, files } = await readPreservedLogs(options.to);
  say(summariseLogs(records, files));
}
