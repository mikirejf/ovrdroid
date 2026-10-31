import type { Command } from 'commander';

import { choice, count, guard } from '../cli.ts';
import { INSTALLED_DROID } from '../paths.ts';
import { registerBusyKeysCommand } from './busy-keys-commands.ts';
import { counters, DEFAULT_KEYS } from './counters-run.ts';
import { DEFAULT_DAYS, rendersLog } from './renders-log-run.ts';
import { DEFAULT_TOP, RENDER_SCENARIOS, renders } from './renders-run.ts';
import { registerResumeCommands } from './resume-commands.ts';
import { registerStreamCommands } from './stream-commands.ts';

const COUNTERS_RUNS = 5;
const RENDERS_RUNS = 3;

export function registerRenderCommands(program: Command): void {
  registerStreamCommands(program);
  registerBusyKeysCommand(program);
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

  program
    .command('renders')
    .description(
      'which React components render while Droid streams a reply, reopens a long session, resizes, takes typing and waits on a pending tool, how long each takes on its own, and why it rendered; works on any build carrying the shipped patch set, which records into $OD_RENDERS',
    )
    .argument('<binary>')
    .option('-r, --runs <n>', 'runs per scenario', count, RENDERS_RUNS)
    .option('-s, --scenario <name>', RENDER_SCENARIOS.join(', '), choice(RENDER_SCENARIOS), 'all')
    .option('-n, --top <n>', 'components to print per window', count, DEFAULT_TOP)
    .action(guard(renders));

  program
    .command('renders-log')
    .description(
      'which React components cost the most render time across your own Droid sessions over the last days, summed from what Droid records while /renders is on',
    )
    .option('-d, --days <n>', 'days to read, counting today', count, DEFAULT_DAYS)
    .option('-n, --top <n>', 'components to print', count, DEFAULT_TOP)
    .option('-b, --binary <path>', 'binary whose modules locate each component', INSTALLED_DROID)
    .option(
      '--home <dir>',
      'home folder holding .factory, instead of $FACTORY_HOME_OVERRIDE or your home',
    )
    .action(guard(rendersLog));
}
