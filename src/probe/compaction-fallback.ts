import { randomUUID } from 'node:crypto';
import {
  existsSync,
  readdirSync,
  readFileSync,
  realpathSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';

import { MS_PER_SECOND, say } from '../cli.ts';
import { FACTORY_SESSIONS, ovrdroidFile } from '../paths.ts';
import { withTempDir } from '../temp.ts';
import type { Evidence } from './compaction-fallback-report.ts';
import { CANNED_REFUSAL, compactRowsFor, fallbackVerdict } from './compaction-fallback-report.ts';
import type { CompactionRelay } from './compaction-relay.ts';
import { readUpstream, relaySettings, startCompactionRelay } from './compaction-relay.ts';
import { sessionFolderName } from './ledger.ts';
import { COMPRESS_COMMAND, compress, submit } from './live-session.ts';
import { poll } from './poll.ts';
import type { Session } from './session.ts';
import { openSettledSession } from './session.ts';
import { compactionsOf } from './summaries-report.ts';

export const DEFAULT_FALLBACK_TIMEOUT_S = 180;

const USAGE_LOG = ovrdroidFile('cache-usage.jsonl');
const PROMPT = 'Name three prime numbers. Do not use tools.';
const QUIET_MS = 2000;
const REPLY_TIMEOUT_MS = 60_000;
const TRANSCRIPT_SUFFIX = '.jsonl';

export interface CompactionFallbackOptions {
  cwd: string;
  timeout: number;
  reply?: string;
}

function transcriptWith(folder: string, tag: string, sinceMs: number): string | undefined {
  if (!existsSync(folder)) {
    return undefined;
  }
  return readdirSync(folder)
    .filter((name) => name.endsWith(TRANSCRIPT_SUFFIX))
    .map((name) => path.join(folder, name))
    .filter((file) => statSync(file).mtimeMs >= sinceMs)
    .find((file) => readFileSync(file, 'utf-8').includes(tag));
}

function storedSummaries(transcript: string): string[] {
  const id = path.basename(transcript, TRANSCRIPT_SUFFIX);
  return compactionsOf(id, readFileSync(transcript, 'utf-8')).map((record) => record.text);
}

function readLog(): string {
  return existsSync(USAGE_LOG) ? readFileSync(USAGE_LOG, 'utf-8') : '';
}

interface Drive {
  session: Session;
  relay: CompactionRelay;
  folder: string;
  launchedAt: number;
  timeoutMs: number;
  reply: string;
}

async function driveCompaction(drive: Drive): Promise<Evidence> {
  const { session, relay, folder, launchedAt, timeoutMs, reply } = drive;
  const tag = randomUUID().slice(0, 8);
  await submit(session, `${PROMPT} (probe ${tag})`);

  await poll(() => (relay.kinds().includes('ordinary') ? true : undefined), REPLY_TIMEOUT_MS);
  await session.quiet(QUIET_MS, REPLY_TIMEOUT_MS);
  const transcript = await poll(() => transcriptWith(folder, tag, launchedAt), REPLY_TIMEOUT_MS);
  if (transcript === undefined) {
    throw new Error(`no session transcript in ${folder} carries the prompt`);
  }

  await compress(session);
  const stored = await poll(() => {
    const found = storedSummaries(transcript);
    return found.length === 0 ? undefined : found;
  }, timeoutMs);
  return {
    kinds: relay.kinds(),
    rows: compactRowsFor(readLog(), path.basename(transcript, TRANSCRIPT_SUFFIX)),
    stored: stored ?? [],
    reply,
    timedOut: stored === undefined,
  };
}

async function runFallback(
  binary: string,
  options: CompactionFallbackOptions,
  dir: string,
): Promise<Evidence> {
  const reply =
    options.reply === undefined ? CANNED_REFUSAL : readFileSync(options.reply, 'utf-8').trim();
  const relay = startCompactionRelay(await readUpstream(), reply);
  try {
    const settingsFile = path.join(dir, 'settings.json');
    writeFileSync(settingsFile, JSON.stringify(relaySettings(relay.url)));
    const launchedAt = Date.now();
    const { session } = await openSettledSession(binary, {
      cwd: options.cwd,
      env: { FACTORY_RUNTIME_SETTINGS_PATH: settingsFile },
    });
    try {
      return await driveCompaction({
        session,
        relay,
        folder: path.join(FACTORY_SESSIONS, sessionFolderName(realpathSync(options.cwd))),
        launchedAt,
        timeoutMs: options.timeout * MS_PER_SECOND,
        reply,
      });
    } finally {
      await session.close();
    }
  } finally {
    await relay.stop();
  }
}

export async function compactionFallback(
  binary: string,
  options: CompactionFallbackOptions,
): Promise<void> {
  say(
    `a relay sends every request to Haiku through DroidProxy except the reuse compaction request, which gets a refusal; one prompt, then ${COMPRESS_COMMAND}; waiting up to ${options.timeout}s for the summary`,
  );
  const evidence = await withTempDir(
    'compaction-fallback',
    async (dir) => await runFallback(binary, options, dir),
  );
  const verdict = fallbackVerdict(evidence);
  say(`requests the relay saw, in order: ${evidence.kinds.join(', ')}`);
  say(`${verdict.pass ? 'PASS' : 'FAIL'}: ${verdict.finding}`);
  if (!verdict.pass) {
    process.exitCode = 1;
  }
}
