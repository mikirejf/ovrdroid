import type { Command } from 'commander';

import { guard } from '../cli.ts';
import { escape } from './escape.ts';

export function registerEscapeCommand(program: Command): void {
  program
    .command('escape')
    .description(
      'press Esc while a turn runs: does one Esc keep the turn running, do two quick Esc presses stop it with "Request cancelled by user", does the "(Esc twice to stop)" hint show, and does pressing Esc three times quickly still open the rewind menu?',
    )
    .argument('<binary>')
    .action(guard(escape));
}
