import type { Command } from 'commander';

import { count, guard } from '../cli.ts';
import {
  DEFAULT_REWIND_SCROLL_TIMEOUT_S,
  DEFAULT_REWIND_SCROLL_TURNS,
  rewindScroll,
} from './rewind-scroll.ts';

export function registerRewindScrollCommand(program: Command): void {
  program
    .command('rewind-scroll')
    .description(
      'chat with a stub model, then move through the rewind menu: does the chat above the menu scroll to the highlighted message, does Esc bring back the live chat, and does Enter still rewind?',
    )
    .argument('<binary>')
    .option('--cwd <dir>', 'trusted directory to start Droid in', process.cwd())
    .option(
      '--timeout <seconds>',
      'how long to wait for each step',
      count,
      DEFAULT_REWIND_SCROLL_TIMEOUT_S,
    )
    .option(
      '--turns <n>',
      'user messages to send first; past about 30 the history spans several pages',
      count,
      DEFAULT_REWIND_SCROLL_TURNS,
    )
    .option('--dump <file>', 'save every screen the probe read')
    .action(guard(rewindScroll));
}
