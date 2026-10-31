import type { Command } from 'commander';

import { choice, count, countOrZero, guard } from '../cli.ts';
import { BUSY_SCENARIOS, busyKeys, DEFAULT_RUNS, DEFAULT_TRIALS } from './busy-keys.ts';

export function registerBusyKeysCommand(program: Command): void {
  program
    .command('busy-keys')
    .description(
      'type into the input box while Droid is idle, streams a reply, or runs a tool: how long until each key shows on screen?',
    )
    .argument('<binaries...>')
    .option('-r, --runs <n>', 'number of runs', count, DEFAULT_RUNS)
    .option('-n, --trials <n>', 'keys timed per scenario per run', count, DEFAULT_TRIALS)
    .option(
      '-t, --turns <n>',
      'turns of the resumed session to type into; 0 opens an empty one',
      countOrZero,
      0,
    )
    .option('-s, --scenario <name>', BUSY_SCENARIOS.join(', '), choice(BUSY_SCENARIOS), 'all')
    .action(guard(busyKeys));
}
