import type { Command } from 'commander';

import { guard } from '../cli.ts';
import { cutOff } from './cut-off.ts';

export function registerCutOffCommand(program: Command): void {
  program
    .command('cut-off')
    .description(
      "a custom model's stream drops mid-reply before its terminal event: does Droid retry and show the whole reply, or keep the half?",
    )
    .argument('<binary>')
    .action(guard(cutOff));
}
