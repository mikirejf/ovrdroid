import path from 'node:path';

import { say } from '../cli.ts';
import { requireModel } from './exec.ts';
import { runShield } from './shield-run.ts';
import type { JudgedRun, ShieldRun } from './shield.ts';
import {
  countMistakes,
  describeShield,
  describeUnjudged,
  hasVerdict,
  judgeCases,
  SHIELD_CASES,
} from './shield.ts';

export interface ShieldOptions {
  model: string | undefined;
}

function labelsFor(binaries: readonly string[]): string[] {
  const names = binaries.map((binary) => path.basename(binary));
  return names.map((name, index) =>
    names.indexOf(name) === index ? name : (binaries[index] ?? name),
  );
}

function judge(run: ShieldRun): JudgedRun {
  return {
    label: run.label,
    reading: run.reading,
    verdicts: judgeCases(SHIELD_CASES, run.reading),
  };
}

export async function shield(binaries: string[], options: ShieldOptions): Promise<void> {
  const model = requireModel(options.model);
  const labels = labelsFor(binaries);
  const readings = await Promise.all(
    binaries.map(async (binary) => await runShield(binary, model, SHIELD_CASES)),
  );
  const runs = readings.map((reading, index) => ({ label: labels[index] ?? '', reading }));
  const unjudged = runs.filter((run) => !hasVerdict(run.reading));
  const judged = runs.filter((run) => hasVerdict(run.reading)).map((run) => judge(run));

  say(`one commit of ${SHIELD_CASES.length} staged files, run by ${model} through exec`);
  say('BLOCKED means Droid-Shield stopped the commit on that file; the mark says it was wrong');
  say('');
  if (judged.length > 0) {
    say(describeShield(SHIELD_CASES, judged));
  }
  for (const run of unjudged) {
    say(describeUnjudged(run));
  }

  const missed = judged.some((run) => countMistakes(run.verdicts).missedSecrets > 0);
  if (missed || unjudged.length > 0) {
    process.exitCode = 1;
  }
}
