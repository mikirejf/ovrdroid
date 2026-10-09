import type { Command } from 'commander';

import { count, guard } from '../cli.ts';
import { DEFAULT_SESSIONS, DEFAULT_SINCE_DAYS, external } from './external-report.ts';
import {
  clear,
  DEFAULT_NOTICE_TYPE,
  DEFAULT_SETTLE_S,
  envPair,
  FIRST_SEND_PROMPT,
  firstSend,
  highlight,
  mcpChildren,
  notice,
} from './session-report.ts';
import { sessions, waitMs } from './sessions-report.ts';
import { DEFAULT_OPENS, DEFAULT_RUNS, DEFAULT_WAIT_MS } from './sessions.ts';

export function registerSessionCommands(program: Command): void {
  program
    .command('highlight')
    .description('ask for a code block in a real session: do lazily loaded chunks still resolve?')
    .argument('<binary>')
    .action(guard(highlight));

  program
    .command('sessions')
    .description(
      'run /sessions in a fresh Droid, then again in the same Droid: how long after Enter does the session list show?',
    )
    .argument('<binary>')
    .option('-r, --runs <n>', 'number of fresh launches', count, DEFAULT_RUNS)
    .option('--opens <n>', 'how many times each launch opens the list', count, DEFAULT_OPENS)
    .option(
      '--wait <ms>',
      'pause between the input box showing and typing /sessions; 0 types at once, while startup work still runs',
      waitMs,
      DEFAULT_WAIT_MS,
    )
    .option(
      '--cwd <dir>',
      'directory to start Droid in, which decides the Current Folder tab',
      process.cwd(),
    )
    .action(guard(sessions));

  program
    .command('external')
    .description(
      "who changed the files Droid called modified externally: the agent's own tools, or someone else",
    )
    .option(
      '--since <days>',
      'only transcripts touched in the last N days',
      count,
      DEFAULT_SINCE_DAYS,
    )
    .option('--sessions <dir>', 'where Droid keeps its session transcripts', DEFAULT_SESSIONS)
    .option('--json', 'print the counts as JSON', false)
    .action(guard(external));

  program
    .command('mcp-children')
    .description(
      'open a session and list which stdio MCP servers it keeps running: is each one a live process or dormant until first use?',
    )
    .argument('[binary]', 'Droid binary to launch (default: the installed one)')
    .option('--settle <seconds>', 'how long to wait after the input box', count, DEFAULT_SETTLE_S)
    .option('--env <KEY=VALUE>', 'extra environment for Droid, repeatable', envPair, {})
    .option(
      '--mcp <file>',
      'mcp.json whose stdio servers are counted (default: ~/.factory/mcp.json)',
    )
    .action(guard(mcpChildren));

  program
    .command('notice')
    .description(
      'run a background subagent whose first act is a tool call: does its completion notice carry the report? Needs a PreToolUse hook on Read to reproduce',
    )
    .argument('<binary>')
    .option('--cwd <dir>', 'directory to start Droid in', process.cwd())
    .option('--type <droid>', 'subagent type to launch', DEFAULT_NOTICE_TYPE)
    .action(guard(notice));

  program
    .command('clear')
    .description(
      'run /clear and type straight away: how fast is the new session, is the text kept?',
    )
    .argument('<binary>')
    .action(guard(clear));

  program
    .command('first-send')
    .description(
      'send the first message of a session: does it show at once, and does the turn run?',
    )
    .argument('<binary>')
    .option('--cwd <dir>', 'directory to start Droid in, for its MCP servers', process.cwd())
    .option('--text <msg>', 'the message to send', FIRST_SEND_PROMPT)
    .option(
      '--at-paint',
      'paste as soon as the input box shows, not after the screen settles',
      false,
    )
    .option(
      '--after-clear',
      'run /clear first, then send the first message of the new session',
      false,
    )
    .action(guard(firstSend));
}
