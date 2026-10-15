import type { Command } from 'commander';

import { count, guard } from '../cli.ts';
import { compactionCapture } from './compaction-capture.ts';
import { DEFAULT_DIGEST_FOLDER } from './digest-key.ts';
import { digestRun } from './digest-run.ts';
import { PROBE_MODEL } from './launch.ts';

const DEFAULT_RUNS = 3;
const DEFAULT_PARALLEL = 3;
const DEFAULT_DIGEST_TIMEOUT_S = 900;
const DEFAULT_CAPTURE_TIMEOUT_S = 300;
const DEFAULT_CAPTURE_FILES = 8;
const DEFAULT_CAPTURE_EFFORT = 'medium';

export function registerCompactionLiveCommands(program: Command): void {
  program
    .command('digest-run')
    .description(
      'MAKES REAL MODEL CALLS: on each binary, does a Haiku helper still answer the 84-file digest task correctly after its context compacts, and which compaction path did each compaction take? Sessions are interleaved across the binaries. Each run saves its transcripts in a folder next to its result, so probe digest-grade can read the helper transcript after Droid has cleared its own copy',
    )
    .argument('<binaries...>')
    .option('-r, --runs <n>', 'sessions per binary', count, DEFAULT_RUNS)
    .option('--parallel <n>', 'sessions at once, across all binaries', count, DEFAULT_PARALLEL)
    .option(
      '--timeout <seconds>',
      'how long each session may take to reach the final reply',
      count,
      DEFAULT_DIGEST_TIMEOUT_S,
    )
    .option(
      '-o, --out <dir>',
      'where each session result is written as JSON (default: a new /tmp folder)',
    )
    .option('--prompt <file>', 'text file replacing the built-in parent prompt')
    .option('--folder <dir>', 'folder holding the digest files', DEFAULT_DIGEST_FOLDER)
    .action(guard(digestRun));

  program
    .command('compaction-capture')
    .description(
      'MAKES REAL MODEL CALLS: what exact reuse compaction request does Droid send for a main session on a given model? Reads digest files, runs /compress, and checks the bodies file for the reuse row that `compaction-replay` replays. The binary must be a `probe build --bodies` build',
    )
    .argument('<binary>')
    .option('--model-id <id>', 'customModels id the session runs on', PROBE_MODEL)
    .option('--effort <level>', 'reasoning effort of the session', DEFAULT_CAPTURE_EFFORT)
    .option('-o, --out <file>', 'bodies file to write (default: a new /tmp file)')
    .option(
      '--files <n>',
      'digest files the session reads before compressing',
      count,
      DEFAULT_CAPTURE_FILES,
    )
    .option(
      '--timeout <seconds>',
      'how long to wait for the reads, and again for the summary',
      count,
      DEFAULT_CAPTURE_TIMEOUT_S,
    )
    .action(guard(compactionCapture));
}
