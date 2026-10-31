import type { RunOptions } from '../cli.ts';
import { messageOf, say } from '../cli.ts';
import type { Series } from './ab.ts';
import { interleaveWith } from './ab.ts';
import type { Scenario, ScenarioOptions } from './busy-keys-drive.ts';
import { runScenario, STREAM_PLAN, TRIAL_GAP_MS } from './busy-keys-drive.ts';
import type { Echo } from './busy-keys-read.ts';
import {
  ECHO_TIMEOUT_MS,
  formatSummary,
  pairedMedians,
  summariseEchoes,
} from './busy-keys-read.ts';
import { warmWithLaunch } from './launch.ts';
import { sayPaired } from './paired.ts';

export const BUSY_SCENARIOS = ['idle', 'stream', 'tool', 'all'] as const;
export const DEFAULT_TRIALS = 20;
export const DEFAULT_RUNS = 4;

type Run = Partial<Record<Scenario, Echo[]>>;

export interface BusyKeysOptions extends RunOptions {
  trials: number;
  turns: number;
  scenario: (typeof BUSY_SCENARIOS)[number];
}

const DESCRIPTIONS: Record<Scenario, string> = {
  idle: 'idle: an empty input box, nothing running',
  stream: `stream: a ${STREAM_PLAN.chars}-char reply is streaming from a local stub model`,
  tool: 'tool: an Execute tool call is pending (it only sleeps)',
};

function describe(scenario: Scenario, turns: number): string {
  const where = turns > 0 ? `in a resumed ${turns}-turn session` : 'in a new, empty session';
  return `${DESCRIPTIONS[scenario]}, ${where}`;
}

function scenariosOf(choice: BusyKeysOptions['scenario']): Scenario[] {
  return choice === 'all' ? ['idle', 'stream', 'tool'] : [choice];
}

async function measureRun(
  binary: string,
  scenarios: readonly Scenario[],
  options: ScenarioOptions,
): Promise<Run> {
  const run: Run = {};
  for (const scenario of scenarios) {
    try {
      // oxlint-disable-next-line no-await-in-loop
      run[scenario] = await runScenario(binary, scenario, options);
    } catch (error) {
      throw new Error(`${binary} (${scenario}): ${messageOf(error)}`, { cause: error });
    }
  }
  return run;
}

function seriesOf(results: Series<Run>, scenario: Scenario): Series<Echo[]> {
  return results.map(([binary, runs]) => [binary, runs.map((run) => run[scenario] ?? [])]);
}

export async function busyKeys(binaries: string[], options: BusyKeysOptions): Promise<void> {
  const scenarios = scenariosOf(options.scenario);
  say(
    `each run opens ${options.turns > 0 ? `a resumed ${options.turns}-turn synthetic session (the writer of probe resume)` : 'a new session'} per scenario, then types ${options.trials} marker letters (Cyrillic, not used anywhere in Droid's screen or the stub reply), one at a time, ${TRIAL_GAP_MS}ms apart, erasing each with a backspace`,
  );
  say(
    'a key counts as echoed when the first terminal output written after the key contains its marker: the time is from the write to that output, so streaming output that does not show the key does not end the wait',
  );
  say(
    `a key with no echo within ${ECHO_TIMEOUT_MS}ms is counted as missed and left out of the median, p95 and max`,
  );

  const results = await interleaveWith(
    binaries,
    {
      measure: async (binary) => await measureRun(binary, scenarios, options),
      warmUp: warmWithLaunch,
    },
    options.runs,
  );

  for (const scenario of scenarios) {
    say('');
    say(describe(scenario, options.turns));
    const series = seriesOf(results, scenario);
    for (const [binary, runs] of series) {
      say(formatSummary(binary, summariseEchoes(runs)));
    }
    if (series.length === 2) {
      sayPaired(pairedMedians(series), `${scenario} echo (per-run median)`);
    }
  }
}
