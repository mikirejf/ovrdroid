#!/usr/bin/env bun
import { mkdir, mkdtemp } from 'node:fs/promises';
import path from 'node:path';

import { Command } from 'commander';

import { pairedStats, summarise } from './ab.ts';
import { count, guard, messageOf, say, seconds } from './cli.ts';
import { readProfile, selfTimes } from './cpuprofile.ts';
import type { LaunchResult } from './launch.ts';
import { launch } from './launch.ts';
import { formatModules, parseModules } from './modules.ts';
import { backupPath, INSTALLED_DROID } from './paths.ts';
import { buildProbe } from './probe-build.ts';
import { withTempDir } from './temp.ts';
import { formatTrace, parseTrace, TRACE_HEADER } from './trace.ts';

const DEFAULT_STOCK = backupPath(INSTALLED_DROID);
const SELF_TIME_COUNT = 10;
const INFLATION_FLOOR = 2;
const AB_RUNS = 30;
const TOP_MODULES = 20;
const BODY_WIDTH = 110;

interface RunOptions {
  runs: number;
}

interface Capture {
  binary: string;
  variable: 'OD_TRACE' | 'OD_MODULES';
  filename: string;
  runs?: number;
}

interface Captured {
  text: string;
  timing: LaunchResult;
}

interface Repeat {
  binary: string;
  variable: string;
  file: string;
  total: number;
}

async function captureRuns(request: Repeat, remaining: number): Promise<LaunchResult> {
  await Bun.write(request.file, '');
  const timing = await launch(request.binary, { env: { [request.variable]: request.file } });
  if (remaining === 1) {
    return timing;
  }
  say(`run ${request.total - remaining + 1} of ${request.total}: paint ${seconds(timing.paintMs)}`);
  return await captureRuns(request, remaining - 1);
}

async function capture(request: Capture): Promise<Captured> {
  const total = request.runs ?? 1;
  return await withTempDir(request.variable.toLowerCase(), async (dir) => {
    const file = path.join(dir, request.filename);
    const timing = await captureRuns(
      { binary: request.binary, variable: request.variable, file, total },
      total,
    );
    const text = await Bun.file(file)
      .text()
      .catch(() => '');
    return { text, timing };
  });
}

async function trace(binary: string, options: RunOptions): Promise<void> {
  const captured = await capture({
    binary,
    variable: 'OD_TRACE',
    filename: 'trace.tsv',
    runs: options.runs,
  });
  const rows = parseTrace(captured.text);
  if (rows.length === 0) {
    say('no trace rows: was the binary built with --trace?');
    return;
  }
  say(`paint ${seconds(captured.timing.paintMs)}`);
  say('');
  say(TRACE_HEADER);
  say(formatTrace(rows));
}

interface ModulesOptions {
  top: number;
}

async function modules(binary: string, options: ModulesOptions): Promise<void> {
  const captured = await capture({ binary, variable: 'OD_MODULES', filename: 'modules.tsv' });
  const report = parseModules(captured.text);
  if (report.moduleCount === 0) {
    say('no module rows: was the binary built with --modules?');
    return;
  }
  say(`paint ${seconds(captured.timing.paintMs)}`);
  say(
    `${report.totalMs.toFixed(1)}ms across ${report.moduleCount} modules (${report.unlabelledCount} unlabelled, ${report.unlabelledMs.toFixed(1)}ms)`,
  );
  say(formatModules(report.rows.slice(0, options.top), BODY_WIDTH));
}

type Series = readonly [string, number[]];

async function abLaunches(entries: readonly Series[]): Promise<void> {
  const [head, ...rest] = entries;
  if (head === undefined) {
    return;
  }
  const [binary, values] = head;
  const timing = await launch(binary).catch((error: unknown) => {
    throw new Error(`${binary}: launch failed: ${messageOf(error)}`);
  });
  values.push(timing.paintMs);
  await abLaunches(rest);
}

async function abRound(entries: readonly Series[], round: number): Promise<void> {
  await abLaunches(round % 2 === 0 ? entries : entries.toReversed());
}

async function abRounds(entries: readonly Series[], done: number, total: number): Promise<void> {
  if (done === total) {
    return;
  }
  await abRound(entries, done);
  await abRounds(entries, done + 1, total);
}

function sayPaired(results: readonly Series[]): void {
  const [first, second] = results;
  if (first === undefined || second === undefined || results.length !== 2) {
    say('');
    say('a paired difference needs exactly two binaries');
    return;
  }
  const stats = pairedStats(first[1], second[1]);
  say('');
  say(`paired difference (${second[0]} minus ${first[0]}), n=${stats.n}`);
  if (stats.n < 2) {
    say('  a spread needs at least two rounds: this difference is one sample, not a result');
    return;
  }
  if (stats.n % 2 === 1) {
    say(
      '  odd round count: one binary led once more than the other, so position bias is uncancelled',
    );
  }
  const low = stats.meanDiff - stats.margin;
  const high = stats.meanDiff + stats.margin;
  say(
    `  mean ${stats.meanDiff.toFixed(1)}ms  sd ${stats.sdDiff.toFixed(1)}ms  95% CI ${low.toFixed(1)} to ${high.toFixed(1)}`,
  );
  say(`  minimum resolvable effect at this spread: ${stats.margin.toFixed(1)}ms`);
  if (low <= 0 && high >= 0) {
    say('  the difference is not resolved: the interval contains zero');
    return;
  }
  const faster = stats.meanDiff < 0 ? second[0] : first[0];
  say(`  ${faster} is faster by ${Math.abs(stats.meanDiff).toFixed(1)}ms`);
}

async function ab(binaries: string[], options: RunOptions): Promise<void> {
  const results: Series[] = binaries.map((binary) => [binary, []]);

  await abRound(results, 0);
  for (const [, values] of results) {
    values.length = 0;
  }

  await abRounds(results, 0, options.runs);

  for (const [binary, values] of results) {
    say(binary);
    say(`  ${summarise(values)}`);
    say(`  all ${values.map((value) => value.toFixed(0)).join(' ')}`);
  }

  sayPaired(results);
}

interface CpuOptions {
  out: string;
}

async function cpu(binary: string, options: CpuOptions): Promise<void> {
  await mkdir(options.out, { recursive: true });
  const dir = await mkdtemp(path.join(options.out, 'run-'));
  const timing = await launch(binary, {
    env: { BUN_OPTIONS: `--cpu-prof --cpu-prof-interval=250 --cpu-prof-dir=${dir}` },
  });
  say(`paint ${seconds(timing.paintMs)}  dir ${dir}`);

  const found = await readProfile(dir, timing.pid);
  say(`profile ${found.name} (${found.written} written; droid spawns a second droid)`);

  const cutMicros = timing.paintMs * 1000;
  const durationMicros = found.profile.endTime - found.profile.startTime;
  say(
    cutMicros >= durationMicros
      ? `no cut: paint at ${(cutMicros / 1000).toFixed(0)}ms is past the ${(durationMicros / 1000).toFixed(0)}ms profiled, so post-paint work is included`
      : `cut at ${(cutMicros / 1000).toFixed(0)}ms of ${(durationMicros / 1000).toFixed(0)}ms profiled (${((cutMicros / durationMicros) * 100).toFixed(0)}%)`,
  );

  const report = selfTimes(found.profile, SELF_TIME_COUNT, cutMicros);
  say(
    `sampling period ${(report.periodMicros / 1000).toFixed(2)}ms (median), ${report.sampleCount} samples`,
  );
  say(
    `${(report.chargedMicros / 1000).toFixed(1)}ms estimated CPU, ${(report.rawMicros / 1000).toFixed(1)}ms of wall time in the window`,
  );
  for (const entry of report.entries) {
    const inflated =
      entry.inflation >= INFLATION_FLOOR ? `   ${entry.inflation.toFixed(1)}x inflated` : '';
    say(`${(entry.micros / 1000).toFixed(1)}ms  ${entry.samples} samples${inflated}`);
    for (const frame of entry.stack) {
      say(`  ${frame}`);
    }
  }
}

const program = new Command().name('probe').description('Startup probe tooling for Droid');

program
  .command('build')
  .description('build a probe binary from the stock one')
  .option('-t, --target <path>', 'stock binary to patch', DEFAULT_STOCK)
  .option('-e, --extra <patches.json>', 'extra patches to include')
  .option('--trace', 'include the tracing patches')
  .option('--modules', 'include the module timing patches')
  .requiredOption('-o, --out <path>', 'where to write the built binary')
  .action(guard(buildProbe));

program
  .command('trace')
  .description('run a traced binary and print its startup timeline')
  .argument('<binary>')
  .option('-r, --runs <n>', 'number of runs', count, 1)
  .action(guard(trace));

program
  .command('modules')
  .description('run a module-timed binary and print the costliest module bodies')
  .argument('<binary>')
  .option('-n, --top <n>', 'how many modules to print', count, TOP_MODULES)
  .action(guard(modules));

program
  .command('ab')
  .description('interleaved A/B of paint time across binaries')
  .argument('<binaries...>')
  .option('-r, --runs <n>', 'number of runs', count, AB_RUNS)
  .action(guard(ab));

program
  .command('cpu')
  .description('record a CPU profile of startup and print the costliest self-time')
  .argument('<binary>')
  .requiredOption('-o, --out <dir>', 'where to write the profile')
  .action(guard(cpu));

await program.parseAsync();
