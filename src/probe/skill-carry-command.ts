import type { Command } from 'commander';

import { count, guard, say } from '../cli.ts';
import { carryOutcome, describeOutcome, describeTurn, readCarry } from './skill-carry-report.ts';
import type { SkillCarryOptions } from './skill-carry.ts';
import { DEFAULT_CARRY_TIMEOUT_S, runSkillCarry } from './skill-carry.ts';

async function skillCarry(binary: string, options: SkillCarryOptions): Promise<void> {
  const run = await runSkillCarry(binary, options);
  const readings = readCarry(run);
  for (const reading of readings) {
    say(describeTurn(reading, run.skill));
  }
  const outcome = carryOutcome(readings);
  say(describeOutcome(outcome));
  if (outcome !== 'carried') {
    process.exitCode = 1;
  }
}

export function registerSkillCarryCommand(program: Command): void {
  program
    .command('skill-carry')
    .description(
      'type a skill with / in a stub-model session, compact twice, restart, and read what the model is sent in each turn: is the skill text still there once, or only its name with a line telling the model to reload it? Makes no real model calls. A "kept session" warning names the restarted session: its transcript was put back before the restart, so the session ledger leaves it, and this probe deletes it itself',
    )
    .argument('<binary>')
    .option(
      '--timeout <seconds>',
      'how long to wait for each turn and each compaction',
      count,
      DEFAULT_CARRY_TIMEOUT_S,
    )
    .option('-o, --out <dir>', 'save every request body the stub model received in this directory')
    .action(guard(skillCarry));
}
