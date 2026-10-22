import type { Command } from 'commander';
import { InvalidArgumentError } from 'commander';

import { count, guard } from '../cli.ts';
import { DEFAULT_START_GAPS_MS, DEFAULT_START_RUNS, typingStart } from './typing-start.ts';

function gapList(raw: string): number[] {
  const parsed = raw.split(',').map((part) => Number(part.trim()));
  if (parsed.some((value) => !Number.isInteger(value) || value < 1)) {
    throw new InvalidArgumentError('expected a comma-separated list of millisecond gaps');
  }
  return parsed;
}

export function registerTypingStartCommand(program: Command): void {
  program
    .command('typing-start')
    .description(
      'type a key every --gaps ms from the early input shell until the real app frame, and compare when the app paints: does typing during startup delay the app?',
    )
    .argument('<stock>')
    .argument('<target>')
    .option('-r, --runs <n>', 'paired runs per gap', count, DEFAULT_START_RUNS)
    .option('--gaps <ms,...>', 'gaps between keys', gapList, DEFAULT_START_GAPS_MS)
    .action(guard(typingStart));
}
