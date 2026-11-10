import type { Command } from 'commander';

import { count, guard, say } from '../cli.ts';
import { readonlyVerdicts } from './readonly-shell-report.ts';
import type { ReadonlyShellOptions } from './readonly-shell.ts';
import { DEFAULT_READONLY_TIMEOUT_S, runReadonlyShell } from './readonly-shell.ts';
import { describeVerdicts } from './stale-edit-cases.ts';

async function readonlyShell(binary: string, options: ReadonlyShellOptions): Promise<void> {
  const verdicts = readonlyVerdicts(await runReadonlyShell(binary, options));
  say(describeVerdicts(verdicts));
  if (verdicts.some((verdict) => !verdict.pass)) {
    process.exitCode = 1;
  }
}

export function registerReadonlyShellCommand(program: Command): void {
  program
    .command('readonly-shell')
    .description(
      'launch and resume two sub-agents in a stub-model session at high autonomy, one with readonly: true and one whose droid file says tools: read-only, and have each try a medium-risk shell command, a high-risk one and Create: does the launch flag leave a shell that runs tests and builds, do both refuse the rest, and does it hold after a resume? Makes no real model calls',
    )
    .argument('<binary>')
    .option(
      '--timeout <seconds>',
      'how long to wait for each sub-agent run to finish',
      count,
      DEFAULT_READONLY_TIMEOUT_S,
    )
    .option('-o, --out <dir>', 'save every request body the stub model received in this directory')
    .action(guard(readonlyShell));
}
