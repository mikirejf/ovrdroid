import { closeSync, openSync } from 'node:fs';
import path from 'node:path';

import { MS_PER_SECOND, say } from '../cli.ts';
import type { Check, GatePhase } from './checks.ts';
import type { CheckResult } from './report.ts';
import { describeResult, summarise } from './report.ts';
import { itemsOf, runPhase } from './schedule.ts';

const REPO_ROOT = path.join(import.meta.dir, '..', '..');

export interface Executed {
  passed: boolean;
  names: string[];
}

async function runCheck(check: Check, logDir: string): Promise<CheckResult> {
  const log = path.join(logDir, `${check.name}.log`);
  const output = openSync(log, 'w');
  const startedAt = performance.now();
  try {
    const child = Bun.spawn([...check.command], {
      cwd: REPO_ROOT,
      env: { ...Bun.env, ...check.env },
      stdin: 'ignore',
      stdout: output,
      stderr: output,
    });
    const exitCode = await child.exited;
    return {
      name: check.name,
      passed: exitCode === 0,
      seconds: (performance.now() - startedAt) / MS_PER_SECOND,
      log,
    };
  } finally {
    closeSync(output);
  }
}

export async function executeGate(phases: readonly GatePhase[], logDir: string): Promise<Executed> {
  say(`${itemsOf(phases).length} checks in ${phases.length} phases, logs in ${logDir}`);
  const startedAt = performance.now();
  const results: CheckResult[] = [];
  for (const phase of phases) {
    say(`phase ${phase.name}: ${phase.lanes.length} lanes, ${phase.lanesAtOnce} at a time`);
    // oxlint-disable-next-line no-await-in-loop
    const phaseResults = await runPhase(phase, async (check) => {
      const result = await runCheck(check, logDir);
      say(describeResult(result));
      return result;
    });
    results.push(...phaseResults);
  }

  const summary = summarise(results, (performance.now() - startedAt) / MS_PER_SECOND);
  for (const line of summary.lines) {
    say(line);
  }
  return { passed: summary.passed, names: results.map((result) => result.name) };
}
