import type { Command } from 'commander';

import { count, guard } from '../cli.ts';
import { counters, DEFAULT_KEYS } from './counters-run.ts';
import { registerResumeCommands } from './resume-commands.ts';
import { registerStreamCommands } from './stream-commands.ts';

const COUNTERS_RUNS = 5;

export function registerRenderCommands(program: Command): void {
  registerStreamCommands(program);
  registerResumeCommands(program);

  program
    .command('counters')
    .description(
      'count commits, frames, renders and markdown parses in an idle session, while typing, and while opening the slash menu; needs a build from probe build --counters',
    )
    .argument('<binaries...>')
    .option('-r, --runs <n>', 'number of runs', count, COUNTERS_RUNS)
    .option('-k, --keys <n>', 'keys typed in the typing window', count, DEFAULT_KEYS)
    .action(guard(counters));
}
