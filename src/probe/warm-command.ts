import type { Command } from 'commander';

import { count, guard } from '../cli.ts';
import { PROBE_MODEL } from './launch.ts';
import { DEFAULT_WARM_DELAY_S, DEFAULT_WARM_TIMEOUT_S, warmProbe } from './warm.ts';

export function registerWarmCommand(program: Command): void {
  program
    .command('warm')
    .description(
      'MAKES REAL MODEL CALLS: leave a session idle while a background sub-agent runs, with the warm delay shortened: does the cache warmer fire, read the cached prefix, keep the next turn reading it, and does the footer cache clock reset on the warm? Fails unless --yes, and fails when the run could not exercise the warmer. About --delay plus 60 seconds',
    )
    .argument('<binary>')
    .option('--model <id>', 'session model', PROBE_MODEL)
    .option(
      '--delay <seconds>',
      'warm delay to set through the environment; at least 75 so the footer counts down a minute first',
      count,
      DEFAULT_WARM_DELAY_S,
    )
    .option('--timeout <seconds>', 'how long each turn may take', count, DEFAULT_WARM_TIMEOUT_S)
    .option('--yes', 'actually send, and spend the tokens', false)
    .action(guard(warmProbe));
}
