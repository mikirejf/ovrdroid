import type { Command } from 'commander';

import { count, guard } from '../cli.ts';
import { TASK_NAMES } from './task-ab-fixtures.ts';
import { taskAb, taskAbReport } from './task-ab.ts';

const DEFAULT_MODELS = [
  'custom:droidproxy:opus-5-5',
  'custom:droidproxy:sonnet-5-5',
  'custom:droidproxy:haiku-5-5',
];
const DEFAULT_REPS = 3;
const DEFAULT_PARALLEL = 6;
const DEFAULT_TIMEOUT_S = 900;
const DEFAULT_SEED = 1;

export function registerTaskAbCommands(program: Command): void {
  program
    .command('task-ab')
    .description(
      'MAKES REAL MODEL CALLS: run the same small coding tasks through `droid exec` on each binary and model: does each answer correctly, and in how many model requests, how much time and at what cost? Also counts top-level Read/Grep calls, Script calls, calls made inside Scripts and failed tool calls, read from each session transcript. Built to compare tool surfaces, e.g. a build with a patch against one built `--without <patch>`: `bun run probe build --extra <patches.json> --without <patch> -o <path>` makes the second arm. Fails unless --yes. Every task is generated fresh in a scratch folder with a known answer; repetitions and tasks run one after another, and all models and binaries of one task run side by side, interleaved',
    )
    .argument(
      '<binaries...>',
      'binaries to compare; label one as label=path (default label: the file name)',
    )
    .option(
      '-m, --models <ids...>',
      'customModels ids to run every task on; give the binaries first, since the list takes every word up to the next option',
      DEFAULT_MODELS,
    )
    .option('-t, --tasks <names...>', `tasks to run: ${TASK_NAMES.join(', ')} (default: all)`)
    .option(
      '-r, --reps <n>',
      'repetitions of every task on every model and binary',
      count,
      DEFAULT_REPS,
    )
    .option(
      '--parallel <n>',
      'runs at once within one task of one repetition',
      count,
      DEFAULT_PARALLEL,
    )
    .option('--timeout <seconds>', 'how long each run may take', count, DEFAULT_TIMEOUT_S)
    .option('--seed <n>', 'changes the generated fixtures', count, DEFAULT_SEED)
    .option('-o, --out <dir>', 'where rows.jsonl is written (default: a new /tmp folder)')
    .option('--yes', 'actually run, and spend the tokens', false)
    .action(guard(taskAb));

  program
    .command('task-ab-report')
    .description(
      'print the task-ab report again from the rows.jsonl of one or more earlier runs, without any model call',
    )
    .argument('<rows...>', 'rows.jsonl files written by `probe task-ab`')
    .action(guard(taskAbReport));
}
