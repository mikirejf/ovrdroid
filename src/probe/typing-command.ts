import type { Command } from 'commander';

import { count, guard, messageOf, say } from '../cli.ts';
import { interleave } from './ab.ts';
import { DEFAULT_TYPING_GAP_MS, DEFAULT_TYPING_MS, measureTyping } from './typing-run.ts';
import { describeTyping } from './typing.ts';

interface TypingCommandOptions {
  runs: number;
  duration: number;
  gap: number;
  real: boolean;
  cwd: string;
}

async function typing(binaries: string[], options: TypingCommandOptions): Promise<void> {
  const results = await interleave(
    binaries,
    async (binary) =>
      await measureTyping(binary, {
        durationMs: options.duration,
        gapMs: options.gap,
        real: options.real,
        cwd: options.cwd,
      }).catch((error: unknown) => {
        throw new Error(`${binary}: ${messageOf(error)}`);
      }),
    options.runs,
  );
  for (const [binary, readings] of results) {
    say(binary);
    for (const reading of readings) {
      say(`  ${describeTyping(reading)}`);
    }
  }
}

export function registerTypingCommand(program: Command): void {
  program
    .command('typing')
    .description(
      'type a key every --gap ms from the moment the input box paints: how long until keys show in the box, and does any key stall?',
    )
    .argument('<binaries...>')
    .option('-r, --runs <n>', 'number of runs', count, 1)
    .option('-d, --duration <ms>', 'how long to keep typing after paint', count, DEFAULT_TYPING_MS)
    .option('-g, --gap <ms>', 'pause between keys', count, DEFAULT_TYPING_GAP_MS)
    .option(
      '--real',
      'run on your real ~/.factory settings, hooks and herdr env instead of the probe settings; sessions it opens stay in your history',
      false,
    )
    .option('--cwd <dir>', 'directory to launch Droid in', process.cwd())
    .action(guard(typing));
}
