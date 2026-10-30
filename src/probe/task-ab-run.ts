import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { MS_PER_SECOND } from '../cli.ts';
import { resultLine } from './cachekey.ts';
import { clip, timeRun } from './exec.ts';
import { counted, fieldsOf, worded } from './fields.ts';
import { launchEnv, race } from './launch.ts';
import { Ledger } from './owned-sessions.ts';
import { buildTask } from './task-ab-fixtures.ts';
import type { Task } from './task-ab-fixtures.ts';
import type { Grade, Outcome } from './task-ab-grade.ts';
import type { Context, Job } from './task-ab-plan.ts';
import type { RunRow } from './task-ab-rows.ts';
import { usageCost } from './task-ab-rows.ts';
import { countFinishedTranscript, emptyCounts } from './task-ab-transcript.ts';

const TEST_TIMEOUT_MS = 120_000;
export interface RunUsage {
  input: number;
  cacheRead: number;
  cacheWrite: number;
  output: number;
}

interface ExecResult {
  sessionId: string;
  reply: string;
  isError: boolean;
  usage: RunUsage;
}

export function parseExecResult(stdout: string): ExecResult | undefined {
  const fields = resultLine(stdout);
  const sessionId = fields === undefined ? '' : worded(fields, 'session_id');
  if (fields === undefined || sessionId === '') {
    return undefined;
  }
  const usage = fieldsOf(fields.get('usage'));
  return {
    sessionId,
    reply: worded(fields, 'result'),
    isError: fields.get('is_error') === true,
    usage: {
      input: counted(usage, 'input_tokens'),
      cacheRead: counted(usage, 'cache_read_input_tokens'),
      cacheWrite: counted(usage, 'cache_creation_input_tokens'),
      output: counted(usage, 'output_tokens'),
    },
  };
}

function writeFixture(dir: string, files: Task['files']): void {
  for (const [name, content] of Object.entries(files)) {
    const file = path.join(dir, name);
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, content);
  }
}

async function testExit(dir: string): Promise<number> {
  const child = Bun.spawn([process.execPath, 'test'], {
    cwd: dir,
    stdin: 'ignore',
    stdout: 'ignore',
    stderr: 'ignore',
  });
  try {
    return await race(child.exited, TEST_TIMEOUT_MS, `bun test was still running in ${dir}`);
  } finally {
    child.kill();
  }
}

async function outcomeOf(task: Task, dir: string, reply: string): Promise<Outcome> {
  const files = Object.fromEntries(
    task.watch.map((name) => {
      const file = path.join(dir, name);
      return [name, existsSync(file) ? readFileSync(file, 'utf-8') : undefined];
    }),
  );
  return { reply, files, testExit: task.runTests ? await testExit(dir) : undefined };
}

function gradeOf(task: Task, result: ExecResult, outcome: Outcome): Grade {
  return result.isError
    ? { pass: false, reason: `droid reported an error: ${clip(result.reply)}` }
    : task.grade(outcome);
}

async function execResult(
  { arm, model }: Job,
  task: Task,
  { dir, ledger, timeoutMs }: { dir: string; ledger: Ledger; timeoutMs: number },
): Promise<{ result: ExecResult; seconds: number }> {
  const startedAt = performance.now();
  const child = Bun.spawn(
    [arm.binary, 'exec', '-m', model, '-o', 'json', ...task.autonomy, task.prompt],
    {
      cwd: dir,
      stdin: 'ignore',
      stdout: 'pipe',
      stderr: 'pipe',
      env: launchEnv(ledger.env),
    },
  );
  ledger.adopt(child);
  ledger.expectSession();
  const run = await timeRun(child, { binary: arm.binary, startedAt, timeoutMs });
  const result = parseExecResult(run.stdout);
  if (result === undefined) {
    throw new Error(
      `no JSON result on stdout (exit ${run.exitCode}): ${clip(run.stderr) || clip(run.stdout) || 'no output at all'}`,
    );
  }
  return { result, seconds: run.totalMs / MS_PER_SECOND };
}

export async function exercise(job: Job, context: Context, dir: string): Promise<RunRow> {
  const task = buildTask(job.task, `${context.seed}:${job.rep}:${job.task}`);
  writeFixture(dir, task.files);
  const price = context.prices.get(job.model);
  const ledger = new Ledger(dir);
  try {
    const { result, seconds } = await execResult(job, task, {
      dir,
      ledger,
      timeoutMs: context.timeoutMs,
    });
    const grade = gradeOf(task, result, await outcomeOf(task, dir, result.reply));
    const counts = await countFinishedTranscript(result.sessionId);
    return {
      ...counts,
      rep: job.rep,
      task: job.task,
      model: job.model,
      arm: job.arm.label,
      seconds,
      correct: grade.pass,
      reason: grade.reason,
      error: null,
      sessionId: result.sessionId,
      usage: result.usage,
      costUsd: price === undefined ? null : usageCost(price, result.usage),
    };
  } finally {
    await ledger.release();
  }
}

export function brokenRow(job: Job, error: string, priced: boolean): RunRow {
  return {
    ...emptyCounts(),
    rep: job.rep,
    task: job.task,
    model: job.model,
    arm: job.arm.label,
    seconds: 0,
    correct: false,
    reason: '',
    error,
    sessionId: '',
    usage: { input: 0, cacheRead: 0, cacheWrite: 0, output: 0 },
    costUsd: priced ? 0 : null,
  };
}
