import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { messageOf, MS_PER_SECOND, say } from '../cli.ts';
import { makeTempDir, withTempDir } from '../temp.ts';
import { jsonlAppender } from './jsonl.ts';
import { inPool } from './pool.ts';
import { findModelPrices } from './prices-report.ts';
import type { ModelPrice } from './prices.ts';
import { parseArms, parseTasks, planSets } from './task-ab-plan.ts';
import type { Context, Job } from './task-ab-plan.ts';
import { describeRun, reportLines } from './task-ab-report.ts';
import { parseRows } from './task-ab-rows.ts';
import type { RunRow } from './task-ab-rows.ts';
import { brokenRow, exercise } from './task-ab-run.ts';

export interface TaskAbOptions {
  models: string[];
  tasks?: string[];
  reps: number;
  parallel: number;
  timeout: number;
  seed: number;
  out?: string;
  yes: boolean;
}

async function runJob(job: Job, context: Context): Promise<RunRow> {
  let row: RunRow;
  try {
    row = await withTempDir('task-ab', async (dir) => await exercise(job, context, dir));
  } catch (error) {
    row = brokenRow(job, messageOf(error), context.prices.get(job.model) !== undefined);
  }
  await context.append(row);
  say(describeRun(row));
  return row;
}

async function priceTable(models: readonly string[]): Promise<Map<string, ModelPrice | undefined>> {
  const priced = await findModelPrices(models);
  for (const [model, price] of priced) {
    if (price === undefined) {
      process.stderr.write(`no price known for ${model}; dollar figures for it are left out\n`);
    }
  }
  return priced;
}

export async function taskAb(binaries: string[], options: TaskAbOptions): Promise<void> {
  const arms = parseArms(binaries);
  for (const { binary } of arms) {
    if (!existsSync(binary)) {
      throw new Error(`${binary} does not exist`);
    }
  }
  const tasks = parseTasks(options.tasks);
  const sets = planSets({ arms, models: options.models, tasks, reps: options.reps });
  const total = sets.reduce((sum, set) => sum + set.length, 0);
  say(
    `${total} runs: ${options.reps} reps of ${tasks.join(', ')} on ${options.models.join(', ')}, each through ${arms.map((arm) => arm.label).join(', ')}`,
  );
  say(
    `one task of one rep at a time, up to ${options.parallel} runs at once within it, binaries interleaved`,
  );
  if (!options.yes) {
    say('nothing was sent; re-run with --yes to spend it');
    process.exitCode = 1;
    return;
  }
  const out = path.resolve(options.out ?? makeTempDir('task-ab'));
  mkdirSync(out, { recursive: true });
  const rowsFile = path.join(out, 'rows.jsonl');
  say(`one row per run goes to ${rowsFile}; \`probe task-ab-report\` rebuilds the report from it`);
  const context: Context = {
    prices: await priceTable(options.models),
    seed: options.seed,
    timeoutMs: options.timeout * MS_PER_SECOND,
    append: jsonlAppender(rowsFile),
  };
  const rows: RunRow[] = [];
  for (const set of sets) {
    // oxlint-disable-next-line no-await-in-loop
    rows.push(...(await inPool(set, options.parallel, async (job) => await runJob(job, context))));
  }
  say('');
  for (const line of reportLines(rows)) {
    say(line);
  }
  if (rows.some((row) => row.error !== null)) {
    process.exitCode = 1;
  }
}

export function taskAbReport(files: string[]): void {
  const rows = files.flatMap((file) => parseRows(readFileSync(file, 'utf-8')));
  if (rows.length === 0) {
    throw new Error(`${files.join(', ')} hold no task-ab rows`);
  }
  for (const line of reportLines(rows)) {
    say(line);
  }
}
