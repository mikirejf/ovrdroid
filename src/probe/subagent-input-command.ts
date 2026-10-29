import type { Command } from 'commander';

import { count, guard } from '../cli.ts';
import { DEFAULT_SUBAGENT_INPUT_TIMEOUT_S, subagentInput } from './subagent-input.ts';

export function registerSubagentInputCommand(program: Command): void {
  program
    .command('subagent-input')
    .description(
      "switch into a subagent's session from the droids view and back: is the input box bold magenta with a SUBAGENT label only while the subagent is in focus?",
    )
    .argument('<binary>')
    .option(
      '--cwd <dir>',
      'directory to start Droid in; Droid must already trust it',
      process.cwd(),
    )
    .option(
      '--timeout <seconds>',
      'how long to wait for the sub-agent to start',
      count,
      DEFAULT_SUBAGENT_INPUT_TIMEOUT_S,
    )
    .option('--out <dir>', 'save both input-box screens in this directory as subagent-input.txt')
    .action(guard(subagentInput));
}
