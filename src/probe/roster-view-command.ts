import type { Command } from 'commander';

import { count, guard } from '../cli.ts';
import { DEFAULT_ROSTER_TIMEOUT_S, rosterView } from './roster-view.ts';

export function registerRosterViewCommand(program: Command): void {
  program
    .command('roster-view')
    .description(
      'with the droids_view flag off, run a stub droid that launches two sibling droids, press Down on the "droids working" line: does the session roster list both children, each with the model chip?',
    )
    .argument('<binary>')
    .option(
      '--cwd <dir>',
      'directory to start Droid in; Droid must already trust it',
      process.cwd(),
    )
    .option(
      '--timeout <seconds>',
      'how long to wait for each step',
      count,
      DEFAULT_ROSTER_TIMEOUT_S,
    )
    .option('--out <dir>', 'save the roster screen in this directory as roster-view.txt')
    .action(guard(rosterView));
}
