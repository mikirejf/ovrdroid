import type { Command } from 'commander';

import { count, guard } from '../cli.ts';
import { census, DEFAULT_CENSUS_TOP, DEFAULT_CENSUS_WINDOW_S } from './census-report.ts';

export function registerCensusCommand(program: Command): void {
  program
    .command('census')
    .description(
      'what the whole machine spends memory and CPU on, grouped by program, with the Droid share and the dev processes that lost their parent',
    )
    .option('-w, --window <s>', 'seconds to measure CPU over', count, DEFAULT_CENSUS_WINDOW_S)
    .option('--top <n>', 'rows per section', count, DEFAULT_CENSUS_TOP)
    .action(guard(census));
}
