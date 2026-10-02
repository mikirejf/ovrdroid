#!/usr/bin/env bun
import { Command } from 'commander';

import { choice, count, guard } from '../cli.ts';
import {
  ARM_NAMES,
  busts,
  DEFAULT_BUST_SOURCE,
  DEFAULT_CLIFF_MINUTES,
  DEFAULT_EFFORT_MODEL,
  DEFAULT_EFFORT_PROMPT_TOKENS,
  DEFAULT_EFFORT_RUNS,
  DEFAULT_LOG_SOURCE,
  DEFAULT_LOG_STORE,
  DEFAULT_MODEL,
  DEFAULT_PROMPT_TOKENS,
  DEFAULT_QUOTA_MODEL,
  DEFAULT_QUOTA_PROMPT_TOKENS,
  DEFAULT_QUOTA_RUNS,
  DEFAULT_QUOTA_STEPS,
  DEFAULT_TTL_RUNS,
  effortCache,
  logs,
  minuteList,
  prices,
  quota,
  SCHEDULE_NAMES,
  ttl,
} from './cache-report.ts';
import { bodies, modules, trace } from './capture-report.ts';
import { cpu, idleCpu } from './cpu-report.ts';
import { cachekey, DEFAULT_CACHEKEY_DIR, defaultModel, exec, STAGES } from './exec-report.ts';
import { DEFAULT_WINDOW_S, idle } from './idle-report.ts';
import type { ChurnKind } from './menu-report.ts';
import { CHURN_GAP_MS, CHURN_KINDS, DEFAULT_ROUNDS, menu, touches, watch } from './menu-report.ts';
import { buildProbe, DEFAULT_STOCK } from './probe-build.ts';
import { anchors, builds, extract, grep, hub, names } from './release-report.ts';
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
import {
  ab,
  DEFAULT_CHARS,
  DEFAULT_CLEARS,
  DEFAULT_GAP_MS,
  DEFAULT_TRIALS,
  effort,
  effortClear,
  keys,
} from './speed-report.ts';
import { timers } from './timers-report.ts';

const AB_RUNS = 30;
const KEYS_RUNS = 3;
const IDLE_RUNS = 5;
const EXEC_RUNS = 30;
const CACHEKEY_RUNS = 5;
const EXEC_PROMPT = 'Reply with exactly: ok';
const EXEC_EXPECT = 'ok';
const TOP_MODULES = 20;
const CONTEXT_SPAN = 200;
const DEFAULT_CHURN: ChurnKind = 'startup';
const CHURN_DESCRIPTION = `what disturbs the menu: ${CHURN_KINDS.join(', ')}`;

const program = new Command().name('probe').description('Startup probe tooling for Droid');

program
  .command('build')
  .description('build a probe binary from the stock one')
  .option('-t, --target <path>', 'stock binary to patch', DEFAULT_STOCK)
  .option('-e, --extra <patches.json>', 'extra patches to include')
  .option('--trace', 'include the tracing patches')
  .option('--modules', 'include the module timing patches')
  .option('--watch', 'include the file-watcher and catalog logging patches')
  .option('--timers', 'include the timer census patches')
  .option('--bodies', 'include the patches that write every LLM request body to $OD_BODIES')
  .option(
    '--without <names...>',
    'leave out these shipped patches and their name- companions, to A/B what each one buys',
  )
  .requiredOption('-o, --out <path>', 'where to write the built binary')
  .action(guard(buildProbe));

program
  .command('bodies')
  .description(
    'read request bodies from a --bodies build: where each request stops extending the one before, which is where the prompt cache breaks',
  )
  .argument('<file>')
  .action(guard(bodies));

program
  .command('trace')
  .description('run a traced binary and print its startup timeline')
  .argument('<binary>')
  .option('-r, --runs <n>', 'number of runs', count, 1)
  .action(guard(trace));

program
  .command('modules')
  .description('run a module-timed binary and print the costliest module bodies')
  .argument('<binary>')
  .option('-n, --top <n>', 'how many modules to print', count, TOP_MODULES)
  .action(guard(modules));

program
  .command('ab')
  .description('interleaved A/B of paint time across binaries')
  .argument('<binaries...>')
  .option('-r, --runs <n>', 'number of runs', count, AB_RUNS)
  .action(guard(ab));

program
  .command('keys')
  .description('interleaved A/B of keystroke echo latency and typing lag across binaries')
  .argument('<binaries...>')
  .option('-r, --runs <n>', 'number of runs', count, KEYS_RUNS)
  .option('-n, --trials <n>', 'keypresses timed per run', count, DEFAULT_TRIALS)
  .option('-c, --chars <n>', 'keys in the sustained burst', count, DEFAULT_CHARS)
  .option('-g, --gap <ms>', 'gap between burst keys', count, DEFAULT_GAP_MS)
  .action(guard(keys));

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

function churnOptions(command: Command): Command {
  return command
    .option('--churn <kind>', CHURN_DESCRIPTION, choice(CHURN_KINDS), DEFAULT_CHURN)
    .option('-r, --rounds <n>', 'how many churn rounds', count, DEFAULT_ROUNDS)
    .option('-g, --gap <ms>', 'pause between churn rounds', count, CHURN_GAP_MS)
    .option('--with <path>', 'binary to launch for startup churn', '');
}

churnOptions(
  program
    .command('menu')
    .description('open the command menu under churn and report flicker')
    .argument('<binary>'),
).action(guard(menu));

churnOptions(
  program
    .command('watch')
    .description('log file events, watcher wake-ups and catalog rescans under churn')
    .argument('<binary>'),
).action(guard(watch));

program
  .command('highlight')
  .description('ask for a code block in a real session: do lazily loaded chunks still resolve?')
  .argument('<binary>')
  .action(guard(highlight));

program
  .command('mcp-children')
  .description(
    'open a session and list which stdio MCP servers it keeps running: is each one a live process or dormant until first use?',
  )
  .argument('[binary]', 'Droid binary to launch (default: the installed one)')
  .option('--settle <seconds>', 'how long to wait after the input box', count, DEFAULT_SETTLE_S)
  .option('--env <KEY=VALUE>', 'extra environment for Droid, repeatable', envPair, {})
  .option('--mcp <file>', 'mcp.json whose stdio servers are counted (default: ~/.factory/mcp.json)')
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
  .description('run /clear and type straight away: how fast is the new session, is the text kept?')
  .argument('<binary>')
  .action(guard(clear));

program
  .command('first-send')
  .description('send the first message of a session: does it show at once, and does the turn run?')
  .argument('<binary>')
  .option('--cwd <dir>', 'directory to start Droid in, for its MCP servers', process.cwd())
  .option('--text <msg>', 'the message to send', FIRST_SEND_PROMPT)
  .option('--at-paint', 'paste as soon as the input box shows, not after the screen settles', false)
  .option(
    '--after-clear',
    'run /clear first, then send the first message of the new session',
    false,
  )
  .action(guard(firstSend));

program
  .command('effort')
  .description('cycle reasoning effort as early as it shows: does the label move at once and stay?')
  .argument('<binary>')
  .option('--after-clear', 'cycle it straight after /clear instead of at startup', false)
  .action(guard(effort));

program
  .command('effort-clear')
  .description('run /clear a few times: does each new session keep the effort startup showed?')
  .argument('<binary>')
  .option('-c, --clears <n>', 'how many times to run /clear', count, DEFAULT_CLEARS)
  .action(guard(effortClear));

program
  .command('touches')
  .description('show which config files a startup rewrites and which it only touches')
  .argument('<binary>')
  .action(guard(touches));

program
  .command('extract')
  .description('write every app module of a binary to a directory, one file each, for grepping')
  .argument('<binary>')
  .requiredOption('-o, --out <dir>', 'where to write the modules')
  .action(guard(extract));

program
  .command('anchors')
  .description('re-find every patch anchor in a new Droid release by identifier shape')
  .argument('<binary>')
  .option('--json', 'print the rebased patches as JSON', false)
  .action(guard(anchors));

program
  .command('builds')
  .description(
    'does the patch set apply to the newest Droid release on every platform we support? Run it before pushing a patch change',
  )
  .option('--version <v>', 'release to check instead of the newest one')
  .action(guard(builds));

program
  .command('grep')
  .description('count where a literal occurs across the app: can it anchor a patch on its own?')
  .argument('<binary>')
  .argument('<needle>')
  .option('-s, --span <chars>', 'characters of surrounding code to print', count, CONTEXT_SPAN)
  .option('-q, --quiet', 'print only the verdict, not the surrounding code', false)
  .action(guard(grep));

program
  .command('hub')
  .description(
    'is the MCP hub test fixture still stock code, names aside? For each method upstream changed, show the change and the new method in fixture names',
  )
  .argument('<binary>', 'a stock build: a .orig backup or a probe builds download')
  .action(guard(hub));

program
  .command('names')
  .description('resolve the free names a patch body uses, in the module its anchor sits in')
  .argument('<binary>')
  .argument('<anchor>')
  .argument('<names...>')
  .action(guard(names));

program
  .command('idle')
  .description('interleaved A/B of what a Droid costs per minute of standing by')
  .argument('<binaries...>')
  .option('-r, --runs <n>', 'number of runs', count, IDLE_RUNS)
  .option('-w, --window <s>', 'seconds to stand by', count, DEFAULT_WINDOW_S)
  .action(guard(idle));

program
  .command('idle-cpu')
  .description('profile an idle Droid and print what the standing-by CPU is spent on')
  .argument('<binary>')
  .option('-w, --window <s>', 'seconds to stand by', count, DEFAULT_WINDOW_S)
  .requiredOption('-o, --out <dir>', 'where to write the profile')
  .action(guard(idleCpu));

program
  .command('timers')
  .description('census of the timers that wake an idle Droid')
  .argument('<binary>')
  .option('-w, --window <s>', 'seconds to stand by', count, DEFAULT_WINDOW_S)
  .action(guard(timers));

program
  .command('logs')
  .description(
    "copy Droid's request logs out of rotation and say what per-request cache truth they hold",
  )
  .option('--from <dir>', 'where Droid rotates its logs', DEFAULT_LOG_SOURCE)
  .option('--to <dir>', 'where to preserve them', DEFAULT_LOG_STORE)
  .action(guard(logs));

program
  .command('busts')
  .description(
    'join every cache-miss warning to the quota it actually rewrote: what kills the cache, and what that costs',
  )
  .option('--from <dir>', 'where the preserved logs are', DEFAULT_BUST_SOURCE)
  .option('--runs <file>', 'quota runs to price the rewrites against', DEFAULT_QUOTA_RUNS)
  .action(guard(busts));

program
  .command('prices')
  .description('the per-model price table every dollar figure rests on, from models.dev')
  .argument('[ids...]')
  .option('--refresh', 'fetch the catalog again instead of using the cached copy', false)
  .action(guard(prices));

program
  .command('ttl')
  .description(
    'measure the prompt cache through DroidProxy: one schedule per documented rule, live usage back',
  )
  .argument('<schedule>', SCHEDULE_NAMES.join(', '), choice(SCHEDULE_NAMES))
  .option('-m, --model <id>', 'customModels entry to send through', DEFAULT_MODEL)
  .option('--prompt-tokens <n>', 'size of the cached prefix', count, DEFAULT_PROMPT_TOKENS)
  .option('--minutes <list>', 'gaps to try, cliff only', minuteList, DEFAULT_CLIFF_MINUTES)
  .option('--yes', 'actually send, and spend the tokens', false)
  .option(
    '--direct',
    'talk to Anthropic with the OAuth token instead of DroidProxy, which rewrites every ttl to 1h; --model then takes an API model id',
    false,
  )
  .option('--out <file>', 'where every send is appended', DEFAULT_TTL_RUNS)
  .action(guard(ttl));

program
  .command('effort-cache')
  .description(
    'switch reasoning effort, or drop thinking, mid-conversation through DroidProxy: does the prompt cache survive?',
  )
  .option('-m, --model <id>', 'customModels entry to send through', DEFAULT_EFFORT_MODEL)
  .option('--prompt-tokens <n>', 'size of the cached prefix', count, DEFAULT_EFFORT_PROMPT_TOKENS)
  .option('--yes', 'actually send, and spend the tokens', false)
  .option(
    '--direct',
    'talk to Anthropic with the OAuth token instead of DroidProxy; --model then takes an API model id',
    false,
  )
  .option('--out <file>', 'where every send is appended', DEFAULT_EFFORT_RUNS)
  .action(guard(effortCache));

program
  .command('quota')
  .description(
    'measure what a cache write, a cache read and plain input each cost against the Claude Max quota, talking to Anthropic directly',
  )
  .argument('<arm>', ARM_NAMES.join(', '), choice(ARM_NAMES))
  .option('-m, --model <id>', 'model to send to', DEFAULT_QUOTA_MODEL)
  .option('--prompt-tokens <n>', 'size of the prompt', count, DEFAULT_QUOTA_PROMPT_TOKENS)
  .option('--steps <n>', 'how many 1% crossings to observe', count, DEFAULT_QUOTA_STEPS)
  .option('--yes', 'actually send, and spend the quota', false)
  .option('--out <file>', 'where every send is appended', DEFAULT_QUOTA_RUNS)
  .action(guard(quota));

program
  .command('cpu')
  .description('record a CPU profile of startup and print the costliest self-time')
  .argument('<binary>')
  .requiredOption('-o, --out <dir>', 'where to write the profile')
  .action(guard(cpu));

await program.parseAsync();
