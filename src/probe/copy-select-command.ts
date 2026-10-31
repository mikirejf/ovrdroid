import type { Command } from 'commander';

import { guard } from '../cli.ts';
import { copySelect } from './copy-select.ts';

export function registerCopySelectCommand(program: Command): void {
  program
    .command('copy-select')
    .description(
      'reply with a quote and paste a two-line draft: does selecting the quote or the draft with the terminal copy any box-drawing glyph?',
    )
    .argument('<binary>')
    .action(guard(copySelect));
}
