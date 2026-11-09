import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { MS_PER_SECOND, say, whole } from '../cli.ts';
import { bodiesEnv, newBodiesFile, parseBodies } from './bodies.ts';
import { digestFiles, mainTranscript, promptFor } from './compaction-capture.ts';
import { describeRequests, nextTurnPairing } from './compaction-turn-report.ts';
import { logOf } from './effort-switch-turn.ts';
import { openLiveSession, sessionFolder, submit, withLiveDir } from './live-session.ts';
import { turnEnded } from './live-transcript.ts';
import { poll } from './poll.ts';
import { describeProxyEntries, proxyEntries } from './proxy-log.ts';
import { SETTLE_MS, SETTLE_TIMEOUT_MS } from './session.ts';
import { compactionsOf } from './summaries-report.ts';

const AUTONOMY = ['--auto', 'medium'];
const FLUSH_MS = 2000;

export interface CompactionTurnOptions {
  modelId: string;
  effort: string;
  limit: number;
  files: number;
  timeout: number;
  proxyLogs?: string;
}

interface Run {
  sessionId: string;
  compactions: number;
  nextAt: number;
  marker: string;
}

interface Wait {
  folder: string;
  timeoutMs: number;
}

interface Places {
  out: string;
  dir: string;
}

async function finished({ folder, timeoutMs }: Wait, tag: string, what: string) {
  const found = await poll(() => {
    const transcript = mainTranscript(folder, tag);
    return transcript !== undefined && turnEnded(transcript.text) ? transcript : undefined;
  }, timeoutMs);
  if (found === undefined) {
    throw new Error(`${what} did not finish within ${timeoutMs / MS_PER_SECOND}s`);
  }
  return found;
}

async function drive(
  binary: string,
  options: CompactionTurnOptions,
  { out, dir }: Places,
): Promise<Run> {
  const cwd = path.join(dir, 'work');
  mkdirSync(cwd);
  const tag = crypto.randomUUID().slice(0, 8);
  const session = await openLiveSession(binary, {
    cwd,
    dir,
    model: options.modelId,
    effort: options.effort,
    args: AUTONOMY,
    env: bodiesEnv(out),
    settings: { compactionTokenLimitPerModel: { [options.modelId]: options.limit } },
  });
  try {
    await session.quiet(SETTLE_MS, SETTLE_TIMEOUT_MS);
    const wait = { folder: sessionFolder(cwd), timeoutMs: options.timeout * MS_PER_SECOND };
    await submit(session, promptFor(digestFiles(options.files), tag));
    const read = await finished(wait, tag, 'the reading turn');
    const compactions = compactionsOf(read.id, read.text).length;
    if (compactions === 0) {
      throw new Error(
        `the reading turn never compacted under a ${options.limit}-token limit; lower --limit or raise --files`,
      );
    }
    const nextAt = Date.now();
    await submit(session, `Reply with only the word two. (probe ${tag}-next)`);
    await finished(wait, `${tag}-next`, 'the next turn');
    await Bun.sleep(FLUSH_MS);
    return { sessionId: read.id, compactions, nextAt, marker: path.basename(dir) };
  } finally {
    await session.close();
  }
}

export async function compactionTurn(
  binary: string,
  options: CompactionTurnOptions,
): Promise<void> {
  const out = newBodiesFile('compaction-turn');
  say(
    `${options.modelId} at effort ${options.effort} reads ${options.files} digest files under a ${whole(options.limit)}-token compaction limit, then answers one more message; request bodies go to ${out}`,
  );
  const startedAt = Date.now();
  const run = await withLiveDir(
    'compaction-turn',
    async (dir) => await drive(binary, options, { out, dir }),
  );
  say(`session ${run.sessionId} compacted ${run.compactions} time(s) during the reading turn`);
  say('');
  say("Droid's usage log for the session:");
  for (const line of logOf(run.sessionId).usage) {
    say(
      `  ${line.at} ${line.reason}: read ${whole(line.cacheReadInputTokens)}, wrote ${whole(line.cachedTokensWritten)}, uncached ${whole(line.inputTokens)}`,
    );
  }
  const rows = parseBodies(existsSync(out) ? readFileSync(out, 'utf-8') : '').filter(
    (row) => row.sessionId === run.sessionId,
  );
  say('');
  say('requests Droid sent:');
  for (const line of describeRequests(rows, run.nextAt)) {
    say(`  ${line}`);
  }
  say('');
  for (const line of nextTurnPairing(rows, run.nextAt)) {
    say(line);
  }
  if (options.proxyLogs !== undefined) {
    say('');
    say(`proxy request logs in ${options.proxyLogs} for the session in ${run.marker}:`);
    const entries = proxyEntries(options.proxyLogs, startedAt, run.marker);
    for (const line of describeProxyEntries(entries)) {
      say(line);
    }
  }
}
