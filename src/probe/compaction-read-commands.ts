import type { Command } from 'commander';

import { guard } from '../cli.ts';
import { compactionReasons } from './compaction-reasons.ts';
import { compactionVariants } from './compaction-variants.ts';
import { PROBE_MODEL } from './launch.ts';

export function registerCompactionReadCommands(program: Command): void {
  program
    .command('compaction-variants')
    .description(
      'read a folder written by `compaction-replay`: per arm, how often the reply was a summary, a refusal or a summary in the model own layout, with a 95% interval, a Fisher test against reuse, cache share and cost',
    )
    .argument('<out-dir>', 'folder of row-*.json replies')
    .option('--model-id <id>', 'customModels id whose prices are used', PROBE_MODEL)
    .action(guard(compactionVariants));

  program
    .command('compaction-reasons')
    .description(
      'read folders written by `compaction-replay`: for each reply that was a refusal, why did the model refuse, as read from its thinking and the start of its text (concealment, own reasoning, injection, keep working, status instead, none stated)',
    )
    .argument('<out-dirs...>', 'folders of row-*.json replies')
    .action(guard(compactionReasons));
}
