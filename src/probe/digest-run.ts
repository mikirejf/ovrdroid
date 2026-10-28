import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { MS_PER_SECOND, say } from '../cli.ts';
import { ovrdroidFile } from '../paths.ts';
import { makeTempDir } from '../temp.ts';
import { digestKey, readDigestFolder } from './digest-key.ts';
import type { DigestKey } from './digest-key.ts';
import { DIGEST_PARENT_PROMPT } from './digest-prompt.ts';
import type { RunResult } from './digest-run-report.ts';
import {
  describeBinary,
  describeRun,
  digestFindings,
  runResult,
  summariseBinary,
} from './digest-run-report.ts';
import { PROBE_MODEL } from './launch.ts';
import { openLiveSession, sessionFolder, transcriptsIn, withLiveDir } from './live-session.ts';
import type { FinishedChild, Transcript } from './live-transcript.ts';
import { finishedChild, parentOf, turnOutcome } from './live-transcript.ts';
import { poll } from './poll.ts';

const USAGE_LOG = ovrdroidFile('cache-usage.jsonl');
const EFFORT = 'medium';
const AUTONOMY = ['--auto', 'medium'];
const TRAILING_NEWLINES = /\n+$/u;
const COMPLETED = 'completed';

export interface DigestRunOptions {
  runs: number;
  parallel: number;
  timeout: number;
  out?: string;
  prompt?: string;
  folder: string;
}

interface Job {
  binary: string;
  label: string;
  index: number;
  run: number;
}

interface Context {
  prompt: string;
  key: DigestKey;
  timeoutMs: number;
  out: string;
}

function labelOf(binary: string): string {
  return path.basename(binary);
}

function jobsFor(binaries: readonly string[], runs: number): Job[] {
  return Array.from({ length: runs }, (_, at) =>
    binaries.map((binary, index) => ({ binary, label: labelOf(binary), index, run: at + 1 })),
  ).flat();
}

async function inPool<T, R>(
  items: readonly T[],
  width: number,
  work: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = [];
  const queue = items.entries();
  const lane = async (): Promise<void> => {
    for (const [at, item] of queue) {
      // oxlint-disable-next-line no-await-in-loop
      results[at] = await work(item);
    }
  };
  await Promise.all(Array.from({ length: Math.min(width, items.length) }, lane));
  return results;
}

function watchGrunt(folder: string): () => FinishedChild | undefined {
  let known: string | undefined;
  return () => {
    const transcripts = transcriptsIn(folder);
    known ??= parentOf(transcripts)?.id;
    return known === undefined ? undefined : finishedChild(transcripts, known);
  };
}

function jobName(job: Job): string {
  return `${job.index}-${job.label}-run${job.run}`;
}

function keepTranscripts(folder: string, transcripts: readonly Transcript[]): void {
  mkdirSync(folder, { recursive: true });
  for (const transcript of transcripts) {
    writeFileSync(path.join(folder, `${transcript.id}.jsonl`), transcript.text);
  }
}

async function sessionResult(job: Job, context: Context, dir: string): Promise<RunResult> {
  const cwd = path.join(dir, 'work');
  mkdirSync(cwd);
  const startedAt = performance.now();
  const session = await openLiveSession(job.binary, {
    cwd,
    dir,
    model: PROBE_MODEL,
    effort: EFFORT,
    args: [...AUTONOMY, context.prompt],
  });
  try {
    const folder = sessionFolder(cwd);
    const finished = await poll(watchGrunt(folder), context.timeoutMs);
    const transcripts = transcriptsIn(folder);
    const parent = finished?.parent ?? parentOf(transcripts);
    if (parent === undefined) {
      throw new Error(
        `no parent transcript appeared in ${folder} within ${context.timeoutMs / MS_PER_SECOND}s`,
      );
    }
    keepTranscripts(path.join(context.out, jobName(job)), transcripts);
    const outcome = finished === undefined ? undefined : turnOutcome(finished.child.text);
    if (outcome !== undefined && outcome !== COMPLETED) {
      throw new Error(`the grunt turn ended as "${outcome}", not "${COMPLETED}"`);
    }
    return runResult({
      binary: job.label,
      run: job.run,
      parent,
      transcripts,
      log: existsSync(USAGE_LOG) ? readFileSync(USAGE_LOG, 'utf-8') : '',
      key: context.key,
      timedOut: finished === undefined,
      seconds: (performance.now() - startedAt) / MS_PER_SECOND,
    });
  } finally {
    await session.close();
  }
}

async function runJob(job: Job, context: Context): Promise<RunResult> {
  const result = await withLiveDir(
    'digest-run',
    async (dir) => await sessionResult(job, context, dir),
  );
  writeFileSync(path.join(context.out, `${jobName(job)}.json`), JSON.stringify(result, null, 2));
  say(describeRun(result));
  return result;
}

function promptText(file: string | undefined): string {
  return file === undefined
    ? DIGEST_PARENT_PROMPT
    : readFileSync(file, 'utf-8').replace(TRAILING_NEWLINES, '');
}

export async function digestRun(
  binaries: readonly string[],
  options: DigestRunOptions,
): Promise<void> {
  const out = options.out ?? makeTempDir('digest-run-out');
  mkdirSync(out, { recursive: true });
  const context: Context = {
    prompt: promptText(options.prompt),
    key: digestKey(readDigestFolder(options.folder)),
    timeoutMs: options.timeout * MS_PER_SECOND,
    out,
  };
  const jobs = jobsFor(binaries, options.runs);
  say(
    `${jobs.length} sessions on ${PROBE_MODEL}, ${options.parallel} at a time, interleaved across ${binaries.length} binaries; results go to ${out}`,
  );

  const failures: string[] = [];
  const finished = await inPool(jobs, options.parallel, async (job) => {
    try {
      return [{ index: job.index, result: await runJob(job, context) }];
    } catch (error) {
      failures.push(
        `${job.label} run ${job.run}: ${error instanceof Error ? error.message : String(error)}`,
      );
      return [];
    }
  });

  for (const [index, binary] of binaries.entries()) {
    const own = finished.flat().flatMap((done) => (done.index === index ? [done.result] : []));
    const summary = summariseBinary(labelOf(binary), own);
    say('');
    for (const line of describeBinary(summary)) {
      say(line);
    }
    failures.push(...digestFindings(summary));
  }
  if (failures.length > 0) {
    say('');
    for (const failure of failures) {
      process.stderr.write(`FAILED ${failure}\n`);
    }
    process.exitCode = 1;
  }
}
