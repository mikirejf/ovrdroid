import type { Command } from 'commander';

import { count, countOrZero, guard, say } from '../cli.ts';
import { runFlagRefresh } from './scope-leak-flag-run.ts';
import { DEFAULT_FLAG_TIMEOUT_S } from './scope-leak-flags.ts';
import { registerScopeLiveCommand } from './scope-leak-live.ts';
import { describeRun, describeTally, outcomeOf } from './scope-leak-report.ts';
import type { ScopeLeakRun } from './scope-leak-report.ts';
import { runWaitReports } from './scope-leak-wait-run.ts';
import type { ScopeLeakOptions } from './scope-leak.ts';
import {
  DEFAULT_HOLD_S,
  DEFAULT_LINGER_S,
  DEFAULT_SCOPE_RUNS,
  DEFAULT_SCOPE_TIMEOUT_S,
  runScopeLeak,
} from './scope-leak.ts';

interface ScopeLeakCommand extends ScopeLeakOptions {
  runs: number;
}

async function scopeLeak(
  binaries: string[],
  options: ScopeLeakCommand,
  command: Command,
): Promise<void> {
  const runOptions = {
    ...options,
    timeout:
      options.flagRefresh === true && command.getOptionValueSource('timeout') === 'default'
        ? DEFAULT_FLAG_TIMEOUT_S
        : options.timeout,
  };
  if (options.toolMix === true && options.waitReports !== true) {
    throw new Error('--tool-mix requires --wait-reports');
  }
  if (options.responsesFollowup === true && options.responsesChild !== true) {
    throw new Error('--responses-followup requires --responses-child');
  }
  if (options.responsesChild === true && options.waitReports !== true) {
    throw new Error('--responses-child requires --wait-reports');
  }
  if (options.churnDroids === true && options.waitReports !== true) {
    throw new Error('--churn-droids requires --wait-reports');
  }
  const runs: ScopeLeakRun[] = [];
  for (let round = 1; round <= options.runs; round++) {
    for (const binary of binaries) {
      let runScenario = options.waitReports === true ? runWaitReports : runScopeLeak;
      if (options.flagRefresh === true) {
        runScenario = runFlagRefresh;
      }
      // oxlint-disable-next-line no-await-in-loop
      const run = await runScenario(binary, runOptions);
      runs.push(run);
      say(`run ${round} ${binary}: ${describeRun(run)}`);
    }
  }
  say(describeTally(runs));
  if (runs.some((run) => outcomeOf(run) !== 'survived')) {
    process.exitCode = 1;
  }
}
export function registerScopeLeakCommand(program: Command): void {
  registerScopeLiveCommand(program);
  program
    .command('scope-leak')
    .description(
      'let an Anthropic-model background sub-agent of a non-Anthropic main session finish while the main turn it woke keeps the status bar ticking: does the window exit with "Agent runtime scope is disposed"?',
    )
    .argument('<binaries...>')
    .option('-r, --runs <n>', 'runs per binary, interleaved', count, DEFAULT_SCOPE_RUNS)
    .option(
      '--flag-refresh',
      'one child: release changed remote flags 3s after its host closes, using isolated cache and local APIs',
      false,
    )
    .option(
      '--wait-reports',
      'Anthropic main waits on 14 real Task IDs in one message; 11 children finish and 3 remain held',
      false,
    )
    .option(
      '--tool-mix',
      'with --wait-reports, run nested Read, Grep and Execute together in one Script per quick child',
      false,
    )
    .option(
      '--responses-child',
      'with --wait-reports, finish the last quick child on a local HTTP streaming Responses model',
      false,
    )
    .option(
      '--responses-followup',
      'hold a second Responses child until 3s after the first final stream, then stream both turns slowly',
      false,
    )
    .option(
      '--churn-droids',
      'add/remove one unused project droid before the first reply and after first/last teardown; require parent watcher reloads',
      false,
    )
    .option(
      '--out <dir>',
      'save request bodies, tool hook records, process log and evidence in per-run folders',
    )
    .option(
      '--hold <seconds>',
      'how long the stub holds the main turn the completion notice starts',
      count,
      DEFAULT_HOLD_S,
    )
    .option(
      '--linger <seconds>',
      'how long the sub-agent keeps working after the main turn ends; past 3s its own scope paints the screen before it is disposed',
      countOrZero,
      DEFAULT_LINGER_S,
    )
    .option(
      '--timeout <seconds>',
      'how long to wait for each step (150s for --flag-refresh)',
      count,
      DEFAULT_SCOPE_TIMEOUT_S,
    )
    .option(
      '--cwd <dir>',
      'trusted parent directory for a throwaway project; no personal droid files are written',
      '/tmp',
    )
    .action(guard(scopeLeak));
}
