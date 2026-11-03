import type { Command } from 'commander';

import { count, guard } from '../cli.ts';
import {
  DEFAULT_HISTORY_PREVIEW_COUNT,
  DEFAULT_HISTORY_PREVIEW_TIMEOUT_S,
  historyPreview,
} from './history-preview.ts';

export function registerHistoryPreviewCommand(program: Command): void {
  program
    .command('history-preview')
    .description(
      'finish stub helpers, open their saved replies in the roster: does reading history reopen agent runtimes and consume helper slots?',
    )
    .argument('<binary>')
    .option('--cwd <dir>', 'trusted directory to start Droid in', process.cwd())
    .option(
      '--count <n>',
      'helpers to finish before opening the roster',
      count,
      DEFAULT_HISTORY_PREVIEW_COUNT,
    )
    .option(
      '--timeout <seconds>',
      'how long to wait for each step',
      count,
      DEFAULT_HISTORY_PREVIEW_TIMEOUT_S,
    )
    .option('--out <file>', 'save the verdict and roster screen')
    .action(guard(historyPreview));
}
