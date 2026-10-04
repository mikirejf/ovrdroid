import type { Command } from 'commander';

import { choice, count, guard } from '../cli.ts';
import { cachekey, DEFAULT_CACHEKEY_DIR, defaultModel, exec, STAGES } from './exec-report.ts';
import { shield } from './session-report.ts';

const EXEC_RUNS = 30;
const CACHEKEY_RUNS = 5;
const EXEC_PROMPT = 'Reply with exactly: ok';
const EXEC_EXPECT = 'ok';

export function registerExecCommands(program: Command): void {
  program
    .command('exec')
    .description('interleaved A/B of non-interactive exec: startup, answer and shutdown')
    .argument('<binaries...>')
    .option('-r, --runs <n>', 'number of runs', count, EXEC_RUNS)
    .option('--stage <kind>', `what to time: ${STAGES.join(', ')}`, choice(STAGES), 'turn')
    .option('-m, --model <id>', 'model for the turn stage', defaultModel())
    .option('-p, --prompt <text>', 'prompt for the turn stage', EXEC_PROMPT)
    .option('-e, --expect <text>', 'text every run must print, or the probe stops', EXEC_EXPECT)
    .action(guard(exec));

  program
    .command('cachekey')
    .description(
      'start two fresh sessions on a custom OpenAI model: does the second reuse the prompt cache the first wrote?',
    )
    .argument('<binaries...>')
    .option('-m, --model <id>', 'custom OpenAI model to run both sessions on', defaultModel())
    .option('-r, --runs <n>', 'number of runs', count, CACHEKEY_RUNS)
    .option('--cwd <dir>', 'directory both sessions run in', DEFAULT_CACHEKEY_DIR)
    .action(guard(cachekey));

  program
    .command('shield')
    .description('which staged files does Droid-Shield block on commit, and does it miss a secret?')
    .argument('<binaries...>')
    .option('-m, --model <id>', 'model that runs the commit', defaultModel())
    .action(guard(shield));
}
