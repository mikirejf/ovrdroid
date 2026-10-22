import type { RunOptions } from '../cli.ts';
import { messageOf, say } from '../cli.ts';
import type { Series } from './ab.ts';
import { interleave, interleaveWith, summarise } from './ab.ts';
import {
  cycleEffortAfterClear,
  cycleEffortAtStartup,
  describeEffort,
  describeKept,
  effortAcrossClears,
  effortHeld,
  effortKept,
} from './effort.ts';
import type { TailRun } from './key-tails.ts';
import { describeTails, tailsOf, windowVerdict } from './key-tails.ts';
import type { KeysResult } from './keys.ts';
import {
  formatKeys,
  KEY_QUIET_MS,
  keysMeasures,
  measureKeys,
  measureTails,
  TAIL_SETTLE_MS,
} from './keys.ts';
import type { LaunchResult } from './launch.ts';
import { launch, warmWithLaunch } from './launch.ts';
import { sayPaired } from './paired.ts';
import type { Measure } from './regressions.ts';
import { failOnRegressions } from './regressions.ts';

export { DEFAULT_CHARS, DEFAULT_GAP_MS, DEFAULT_TRIALS } from './keys.ts';
export { DEFAULT_CLEARS } from './effort.ts';

export interface KeysOptions extends RunOptions {
  trials: number;
  chars: number;
  gap: number;
  tails: boolean;
}

export const PAINT_FLOOR_MS = 10;
export const QUIT_FLOOR_MS = 20;

export function launchMeasures(timings: Series<LaunchResult>): Measure[] {
  return [
    {
      label: 'paint',
      series: timings.map(([binary, runs]) => [binary, runs.map((run) => run.paintMs)]),
      floor: PAINT_FLOOR_MS,
    },
    {
      label: 'quit',
      series: timings.map(([binary, runs]) => [binary, runs.map((run) => run.exitMs)]),
      floor: QUIT_FLOOR_MS,
    },
  ];
}

export async function ab(binaries: string[], options: RunOptions): Promise<void> {
  const timings = await interleave(
    binaries,
    async (binary) =>
      await launch(binary).catch((error: unknown) => {
        throw new Error(`${binary}: launch failed: ${messageOf(error)}`);
      }),
    options.runs,
  );
  const measures = launchMeasures(timings);

  say('paint: ms from spawn until the input box shows');
  say('quit: ms from Ctrl-C until Droid exited');
  for (const [index, [binary]] of timings.entries()) {
    say('');
    say(binary);
    for (const { label, series } of measures) {
      const values = series[index]?.[1] ?? [];
      say(`  ${label.padEnd(5)} ${summarise(values)}`);
      say(`  all   ${values.map((value) => value.toFixed(0)).join(' ')}`);
    }
  }

  for (const { label, series } of measures) {
    sayPaired(series, label);
  }
  failOnRegressions(measures);
}

async function keyTails(binaries: string[], options: KeysOptions): Promise<void> {
  const measure = async (binary: string): Promise<TailRun> =>
    await measureTails(binary, {
      trials: options.trials,
      chars: options.chars,
      gapMs: options.gap,
    }).catch((error: unknown) => {
      throw new Error(`${binary}: ${messageOf(error)}`);
    });
  const results = await interleaveWith(binaries, { measure, warmUp: warmWithLaunch }, options.runs);
  const tails = results.map(([binary, runs]) => ({ binary, tails: tailsOf(runs) }));

  say(
    `tail: ms from a keypress until its last output byte, after ${TAIL_SETTLE_MS}ms of waiting; the first echo and backspace of each run are left out`,
  );
  say(
    `burst: ms from the last of ${options.chars} keys at ${options.gap}ms until the last output byte`,
  );
  say('');
  for (const each of tails) {
    say(each.binary);
    say(describeTails(each.tails));
    say('');
  }
  say(
    windowVerdict(
      KEY_QUIET_MS,
      tails.map((each) => each.tails),
    ),
  );
}

export async function keys(binaries: string[], options: KeysOptions): Promise<void> {
  if (options.tails) {
    await keyTails(binaries, options);
    return;
  }
  const measure = async (binary: string): Promise<KeysResult> =>
    await measureKeys(binary, {
      trials: options.trials,
      chars: options.chars,
      gapMs: options.gap,
    }).catch((error: unknown) => {
      throw new Error(`${binary}: ${messageOf(error)}`);
    });
  const results = await interleaveWith(binaries, { measure, warmUp: warmWithLaunch }, options.runs);

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

  const measures = keysMeasures(results);
  for (const { label, series } of measures) {
    sayPaired(series, label);
  }
  failOnRegressions(measures);
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

export async function effortClear(binary: string, options: { clears: number }): Promise<void> {
  const reading = await effortAcrossClears(binary, options.clears);
  say(describeKept(reading));
  if (!effortKept(reading)) {
    process.exitCode = 1;
  }
}
