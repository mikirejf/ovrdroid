import type { Command } from 'commander';

import { count, guard } from '../cli.ts';
import { DEFAULT_PLAN, stream } from './stream.ts';

const STREAM_RUNS = 5;

export function registerStreamCommands(program: Command): void {
  program
    .command('stream')
    .description(
      'stream a long markdown reply from a local stub model into a real session: what does rendering it cost in CPU, frames and bytes?',
    )
    .argument('<binaries...>')
    .option('-r, --runs <n>', 'number of runs', count, STREAM_RUNS)
    .option('-c, --chars <n>', 'length of the reply', count, DEFAULT_PLAN.chars)
    .option('--chunk <n>', 'chars per streamed delta', count, DEFAULT_PLAN.chunk)
    .option('-g, --gap-ms <ms>', 'pause between deltas', count, DEFAULT_PLAN.gapMs)
    .action(guard(stream));
}
