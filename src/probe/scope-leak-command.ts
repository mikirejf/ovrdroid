import type { Command } from 'commander';

import { count, countOrZero, guard, say } from '../cli.ts';
import { describeRun, describeTally, outcomeOf } from './scope-leak-report.ts';
import type { ScopeLeakRun } from './scope-leak-report.ts';
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

async function scopeLeak(binaries: string[], options: ScopeLeakCommand): Promise<void> {
  const runs: ScopeLeakRun[] = [];
  for (let round = 1; round <= options.runs; round++) {
    for (const binary of binaries) {
      // oxlint-disable-next-line no-await-in-loop
      const run = await runScopeLeak(binary, options);
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
  program
    .command('scope-leak')
    .description(
      'let an Anthropic-model background sub-agent of a non-Anthropic main session finish while the main turn it woke keeps the status bar ticking: does the window exit with "Agent runtime scope is disposed"?',
    )
    .argument('<binaries...>')
    .option('-r, --runs <n>', 'runs per binary, interleaved', count, DEFAULT_SCOPE_RUNS)
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
    .option('--timeout <seconds>', 'how long to wait for each step', count, DEFAULT_SCOPE_TIMEOUT_S)
    .option(
      '--cwd <dir>',
      'directory to start Droid in; Droid must already trust it',
      process.cwd(),
    )
    .action(guard(scopeLeak));
}
