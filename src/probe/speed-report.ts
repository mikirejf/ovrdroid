import type { RunOptions } from '../cli.ts';
import { messageOf, say } from '../cli.ts';
import { interleave, summarise } from './ab.ts';
import {
  cycleEffortAfterClear,
  cycleEffortAtStartup,
  describeEffort,
  effortHeld,
} from './effort.ts';
import { formatKeys, measureKeys } from './keys.ts';
import { launch } from './launch.ts';
import { sayPaired } from './paired.ts';

export { DEFAULT_CHARS, DEFAULT_GAP_MS, DEFAULT_TRIALS } from './keys.ts';

export interface KeysOptions extends RunOptions {
  trials: number;
  chars: number;
  gap: number;
}

export async function ab(binaries: string[], options: RunOptions): Promise<void> {
  const results = await interleave(
    binaries,
    async (binary) => {
      const timing = await launch(binary).catch((error: unknown) => {
        throw new Error(`${binary}: launch failed: ${messageOf(error)}`);
      });
      return timing.paintMs;
    },
    options.runs,
  );

  for (const [binary, values] of results) {
    say(binary);
    say(`  ${summarise(values)}`);
    say(`  all ${values.map((value) => value.toFixed(0)).join(' ')}`);
  }

  sayPaired(results, 'paint');
}

export async function keys(binaries: string[], options: KeysOptions): Promise<void> {
  const results = await interleave(
    binaries,
    async (binary) =>
      await measureKeys(binary, {
        trials: options.trials,
        chars: options.chars,
        gapMs: options.gap,
      }).catch((error: unknown) => {
        throw new Error(`${binary}: ${messageOf(error)}`);
      }),
    options.runs,
  );

  say('echo: ms from keypress to the first byte back, idle input box');
  say(
    `lag: ms of output still arriving after the last of ${options.chars} keys at ${options.gap}ms`,
  );
  say('');

  for (const [index, [binary, runs]] of results.entries()) {
    say(binary);
    say(formatKeys(runs));
    if (index < results.length - 1) {
      say('');
    }
  }

  sayPaired(
    results.map(([binary, runs]) => [binary, runs.flatMap((run) => run.echoMs)]),
    'echo',
  );
  sayPaired(
    results.map(([binary, runs]) => [binary, runs.map((run) => run.lagMs)]),
    'lag',
  );
}

export async function effort(binary: string, options: { afterClear: boolean }): Promise<void> {
  const reading = options.afterClear
    ? await cycleEffortAfterClear(binary)
    : await cycleEffortAtStartup(binary);
  say(describeEffort(reading));
  if (!effortHeld(reading)) {
    process.exitCode = 1;
  }
}
