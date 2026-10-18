import type { Command } from 'commander';

import { choice, count, countOrZero, guard } from '../cli.ts';
import { compactionFallback, DEFAULT_FALLBACK_TIMEOUT_S } from './compaction-fallback.ts';
import { registerCompactionReadCommands } from './compaction-read-commands.ts';
import { compactionRebuild } from './compaction-rebuild.ts';
import type { Arm } from './compaction-replay-plan.ts';
import { ARMS } from './compaction-replay-plan.ts';
import {
  compactionReplay,
  DEFAULT_REPLAY_PARALLEL,
  DEFAULT_REPLAY_RUNS,
} from './compaction-replay.ts';
import { DEFAULT_SESSIONS, DEFAULT_SINCE_DAYS, external } from './external-report.ts';
import { PROBE_MODEL } from './launch.ts';
import {
  clear,
  DEFAULT_BUSY_TIMEOUT_S,
  DEFAULT_NOTICE_TYPE,
  DEFAULT_REWIND_TIMEOUT_S,
  DEFAULT_SETTLE_S,
  busySignal,
  envPair,
  FIRST_SEND_PROMPT,
  firstSend,
  highlight,
  mcpChildren,
  notice,
  rewind,
} from './session-report.ts';
import { sessions, waitMs } from './sessions-report.ts';
import { DEFAULT_OPENS, DEFAULT_RUNS, DEFAULT_WAIT_MS } from './sessions.ts';
import {
  DEFAULT_SUMMARIES_SESSIONS,
  DEFAULT_SUMMARIES_USAGE,
  sinceDate,
  summaries,
} from './summaries.ts';

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
    .command('summaries')
    .description(
      'which stored compaction summaries are not real summaries, and on which compaction path did each one come out',
    )
    .option(
      '--sessions <dir>',
      'where Droid keeps its session transcripts',
      DEFAULT_SUMMARIES_SESSIONS,
    )
    .option(
      '--usage <file>',
      'per-request cache usage log that holds the compact rows',
      DEFAULT_SUMMARIES_USAGE,
    )
    .option(
      '--since <date>',
      'only compactions at or after this date, such as 2026-10-11',
      sinceDate,
    )
    .action(guard(summaries));

  program
    .command('compaction-replay')
    .description(
      'MAKES REAL MODEL CALLS: send recorded compaction requests again, as captured (reuse path), with one wording change each, as a system message, and rebuilt the stock way: which asks avoid refusals and still read the prompt cache? Replays Messages bodies (Claude models) and Responses bodies (custom GPT models; reuse, no-mention and no-claim arms only). Prints the `compaction-variants` report at the end',
    )
    .argument('<bodies>', 'bodies file written by a `probe build --bodies` binary')
    .option('-r, --runs <n>', 'replies to ask for, per arm per row', count, DEFAULT_REPLAY_RUNS)
    .option(
      '--arms <names...>',
      `arms to send (default: ${ARMS.join(', ')})`,
      (raw: string, previous: Arm[]) => [...previous, choice(ARMS)(raw)],
      [],
    )
    .option(
      '--rows <indexes...>',
      '0-based line numbers of the compaction rows to replay (default: every one)',
      (raw: string, previous: number[]) => [...previous, countOrZero(raw)],
      [],
    )
    .option('--parallel <n>', 'requests in flight at once', count, DEFAULT_REPLAY_PARALLEL)
    .option(
      '--model-id <id>',
      'customModels id whose endpoint and key carry the requests, and whose prices the report uses; bodies keep their captured model',
      PROBE_MODEL,
    )
    .option('-o, --out <dir>', 'where each reply is written as JSON (default: a new /tmp folder)')
    .action(guard(compactionReplay));

  registerCompactionReadCommands(program);

  program
    .command('compaction-fallback')
    .description(
      'MAKES REAL MODEL CALLS: when the model refuses the reuse compaction request, does the patched Droid reject that reply, fall back to the stock summarizer, and store a real summary? A relay forces the refusal',
    )
    .argument('<binary>')
    .option(
      '--cwd <dir>',
      'directory to start Droid in; Droid must already trust it',
      process.cwd(),
    )
    .option(
      '--timeout <seconds>',
      'how long to wait for the compaction to store a summary',
      count,
      DEFAULT_FALLBACK_TIMEOUT_S,
    )
    .option('--reply <file>', 'text file whose contents replace the canned refusal')
    .action(guard(compactionFallback));

  program
    .command('compaction-rebuild')
    .description(
      'rebuild the compaction request Droid sent for a past compaction, from the session transcript, as a bodies row: can a compaction that refused with no captured request be replayed with `compaction-replay`?',
    )
    .argument('<session>', 'session transcript (.jsonl path) or session id')
    .requiredOption(
      '--template <bodies>',
      'bodies file with a captured first compaction and a later one, which supply the system prompt, tools, settings and final instruction',
    )
    .option(
      '--compaction <n...>',
      '1-based compactions to rebuild (default: every one)',
      (raw: string, previous: number[]) => [...previous, count(raw)],
      [],
    )
    .option(
      '--with-last-turn',
      "keep the agent's last turn before the compaction record; by default it is left out, because the summary request usually ran before that turn finished",
      false,
    )
    .option('-o, --out <file>', 'write the rows here instead of to stdout')
    .action(guard(compactionRebuild));

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
    .command('rewind')
    .description(
      'rewind past a turn while background agents run: does a running agent whose call the rewind kept move to the new chat, and does one whose call it cut stay with the old chat?',
    )
    .argument('<binary>')
    .option(
      '--cwd <dir>',
      'directory to start Droid in; Droid must already trust it',
      process.cwd(),
    )
    .option(
      '--timeout <seconds>',
      'how long to wait for the held agents to finish and report',
      count,
      DEFAULT_REWIND_TIMEOUT_S,
    )
    .action(guard(rewind));

  program
    .command('busy-signal')
    .description(
      'launch with HERDR_ENV=1 and hold a background sub-agent in a stub model: does the OSC 9;4 progress stay at 3 (busy) from the turn through the sub-agent and the droids view (Alt+S), reach 0 once it finishes, on a session switch and at exit, and does the droids view show the model chip?',
    )
    .argument('<binary>')
    .option(
      '--cwd <dir>',
      'directory to start Droid in; Droid must already trust it',
      process.cwd(),
    )
    .option('--timeout <seconds>', 'how long to wait for each step', count, DEFAULT_BUSY_TIMEOUT_S)
    .option('--out <dir>', 'save the payload timeline and the droids-view screen in this directory')
    .option('--view', 'fail when the droids view does not open', false)
    .option(
      '--skip-switch',
      'skip the extra launches: switching session with /new and quitting, both while a sub-agent runs',
      false,
    )
    .action(guard(busySignal));

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
