import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { MS_PER_SECOND, say } from '../cli.ts';
import { FACTORY_DROIDS, ovrdroidFile } from '../paths.ts';
import { makeTempDir } from '../temp.ts';
import { digestKey, readDigestFolder } from './digest-key.ts';
import type { DigestKey } from './digest-key.ts';
import { DIGEST_PARENT_PROMPT, DIGEST_READER, DIGEST_READER_FILE } from './digest-prompt.ts';
import type { RunResult } from './digest-run-report.ts';
import {
  describeBinary,
  describeRun,
  digestFindings,
  runResult,
  summariseBinary,
} from './digest-run-report.ts';
import type { ExecEnd } from './exec-session.ts';
import { runDirectExec } from './exec-session.ts';
import { PROBE_MODEL } from './launch.ts';
import { sessionFolder, transcriptsIn, withLiveDir } from './live-session.ts';
import type { Transcript } from './live-transcript.ts';
import { childOf, parentOf, turnOutcome } from './live-transcript.ts';
import { inPool } from './pool.ts';

const USAGE_LOG = ovrdroidFile('cache-usage.jsonl');
const EFFORT = 'medium';
const AUTONOMY = 'high';
const TRAILING_NEWLINES = /\n+$/u;
const COMPLETED = 'completed';
const STDERR_TAIL = 2000;

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

function jobName(job: Job): string {
  return `${job.index}-${job.label}-run${job.run}`;
}

function keepTranscripts(folder: string, transcripts: readonly Transcript[]): void {
  mkdirSync(folder, { recursive: true });
  for (const transcript of transcripts) {
    writeFileSync(path.join(folder, `${transcript.id}.jsonl`), transcript.text);
  }
}

interface Ended {
  job: Job;
  folder: string;
  startedAt: number;
  end: ExecEnd;
}

function readEnd(context: Context, ended: Ended): RunResult {
  const { job, folder, startedAt, end } = ended;
  const transcripts = transcriptsIn(folder);
  const parent = parentOf(transcripts);
  if (parent === undefined) {
    throw new Error(
      end.timedOut
        ? `no parent transcript appeared in ${folder} within ${context.timeoutMs / MS_PER_SECOND}s`
        : `droid exec exited with code ${end.exitCode} and left no parent transcript in ${folder}: ${end.stderr.slice(-STDERR_TAIL)}`,
    );
  }
  keepTranscripts(path.join(context.out, jobName(job)), transcripts);
  if (!end.timedOut && end.exitCode !== 0) {
    throw new Error(
      `droid exec exited with code ${end.exitCode}: ${end.stderr.slice(-STDERR_TAIL)}`,
    );
  }
  const child = childOf(transcripts, parent.id);
  const outcome = end.timedOut || child === undefined ? undefined : turnOutcome(child.text);
  if (outcome !== undefined && outcome !== COMPLETED) {
    throw new Error(`the helper turn ended as "${outcome}", not "${COMPLETED}"`);
  }
  return runResult({
    binary: job.label,
    run: job.run,
    parent,
    transcripts,
    log: existsSync(USAGE_LOG) ? readFileSync(USAGE_LOG, 'utf-8') : '',
    key: context.key,
    timedOut: end.timedOut,
    seconds: (performance.now() - startedAt) / MS_PER_SECOND,
  });
}

async function sessionResult(job: Job, context: Context, dir: string): Promise<RunResult> {
  const cwd = path.join(dir, 'work');
  mkdirSync(cwd);
  const startedAt = performance.now();
  const folder = sessionFolder(cwd);
  return await runDirectExec(
    job.binary,
    {
      cwd,
      dir,
      model: PROBE_MODEL,
      effort: EFFORT,
      autonomy: AUTONOMY,
      prompt: context.prompt,
      timeoutMs: context.timeoutMs,
    },
    (end) => readEnd(context, { job, folder, startedAt, end }),
  );
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

async function withReader<T>(use: () => Promise<T>): Promise<T> {
  const file = path.join(FACTORY_DROIDS, `${DIGEST_READER}.md`);
  mkdirSync(FACTORY_DROIDS, { recursive: true });
  writeFileSync(file, DIGEST_READER_FILE);
  try {
    return await use();
  } finally {
    rmSync(file, { force: true });
  }
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
    `${jobs.length} direct-mode exec sessions on ${PROBE_MODEL}, ${options.parallel} at a time, interleaved across ${binaries.length} binaries; results go to ${out}`,
  );

  const failures: string[] = [];
  const finished = await withReader(
    async () =>
      await inPool(jobs, options.parallel, async (job) => {
        try {
          return [{ index: job.index, result: await runJob(job, context) }];
        } catch (error) {
          failures.push(
            `${job.label} run ${job.run}: ${error instanceof Error ? error.message : String(error)}`,
          );
          return [];
        }
      }),
  );

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
