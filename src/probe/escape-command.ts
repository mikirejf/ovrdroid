import type { Command } from 'commander';

import { guard } from '../cli.ts';
import { escape } from './escape.ts';

export function registerEscapeCommand(program: Command): void {
  program
    .command('escape')
    .description(
      'press Esc twice while a turn runs: does the turn keep running, with no "Request cancelled by user"? Also reports whether the "Press ESC to stop" hint showed. A second turn asks: does pressing Esc three times quickly still open the rewind menu?',
    )
    .argument('<binary>')
    .action(guard(escape));
}
