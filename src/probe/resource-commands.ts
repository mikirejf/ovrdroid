import type { Command } from 'commander';

import { choice, count, countOrZero, guard } from '../cli.ts';
import { idleCpu } from './cpu-report.ts';
import { heap } from './heap-report.ts';
import { DEFAULT_BASELINE_S } from './heap.ts';
import { DEFAULT_TOP, heapdiff } from './heapdiff-report.ts';
import { DEFAULT_WINDOW_S, idle } from './idle-report.ts';
import { lag } from './lag-report.ts';
import { DEFAULT_FOOTPRINT_EVERY, DEFAULT_INTERVAL_MS, sample } from './sample-report.ts';
import { subagentsRead } from './subagents-read.ts';
import { WORKS } from './subagents-record.ts';
import {
  DEFAULT_COUNT,
  DEFAULT_SLEEP_S,
  DEFAULT_SUBAGENTS_OUT,
  DEFAULT_TYPE,
  DEFAULT_WORK,
  MAX_COUNT,
  subagents,
} from './subagents-report.ts';
import { timers } from './timers-report.ts';

const IDLE_RUNS = 5;

export function registerResourceCommands(program: Command): void {
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
    .command('heap')
    .description(
      'read the memory rows of a --heap build: baseline, peak and end per process, and which object types grew',
    )
    .argument('<file>', 'the file the binary appended to through $OD_HEAP')
    .option(
      '-b, --baseline <s>',
      'seconds at the start that count as the baseline',
      count,
      DEFAULT_BASELINE_S,
    )
    .option(
      '--from <s>',
      'start of the growth comparison, seconds after the first row',
      countOrZero,
    )
    .option('--to <s>', 'end of the growth comparison, seconds after the first row', countOrZero)
    .action(guard(heap));

  program
    .command('heapdiff')
    .description(
      'compare two V8 heap snapshots: totals, which (type, name) groups and strings grew, and the shortest route from a GC root that keeps the biggest ones alive',
    )
    .argument('<before>', 'the earlier .heapsnapshot file')
    .argument('<after>', 'the later .heapsnapshot file')
    .option('--top <n>', 'rows per section', count, DEFAULT_TOP)
    .action(guard(heapdiff));

  program
    .command('lag')
    .description(
      'read the rows of a --lag build: how late the event loop of each process ran its 50ms timer, as median p99, worst max and mean busy',
    )
    .argument('<file>', 'the file the binary appended to through $OD_LAG')
    .action(guard(lag));

  program
    .command('sample')
    .description(
      'attach to a live process and report what it and its children cost in memory, CPU and threads over time',
    )
    .argument('<pid>')
    .option('-i, --interval <ms>', 'time between samples', count, DEFAULT_INTERVAL_MS)
    .option(
      '-d, --duration <s>',
      'stop after this many seconds (default: until the pid exits)',
      count,
    )
    .option(
      '--footprint-every <n>',
      'measure the real memory footprint every n samples, 0 for never',
      countOrZero,
      DEFAULT_FOOTPRINT_EVERY,
    )
    .option('-o, --out <file>', 'write every sample here as JSON lines')
    .action(guard(sample));

  program
    .command('subagents')
    .description(
      'launch N parallel Task subagents in a real session and report what they cost the parent in memory, CPU and threads; makes real model calls',
    )
    .argument('<binary>')
    .option('-n, --count <n>', `how many subagents, at most ${MAX_COUNT}`, count, DEFAULT_COUNT)
    .option(
      '-s, --sleep <s>',
      'seconds each subagent sleeps in a shell command',
      count,
      DEFAULT_SLEEP_S,
    )
    .option(
      '--work <mode>',
      `what each subagent does: sleep runs a shell sleep, read reads the --files with the Read tool and summarises them (${WORKS.join(' or ')})`,
      choice(WORKS),
      DEFAULT_WORK,
    )
    .option(
      '--files <globs...>',
      'read mode: files each subagent reads, globs from the current directory (default: the 4 largest .ts files under src/ of this repo); give the binary before this option',
    )
    .option(
      '--type <subagent_type>',
      'subagent type to launch; falls back to one that is offered',
      DEFAULT_TYPE,
    )
    .option(
      '--heap',
      'binary was built with --heap: take a heap snapshot before sending and another after the run, never inside the measured window',
      false,
    )
    .option(
      '--lag',
      'binary was built with --lag: record the parent event-loop lag and report it before, while and after the run',
      false,
    )
    .option(
      '-o, --out <dir>',
      'where to write samples, heap rows, lag rows and snapshots',
      DEFAULT_SUBAGENTS_OUT,
    )
    .action(guard(subagents));

  program
    .command('subagents-read')
    .description(
      'read a finished subagents run again from its ticks.jsonl and timeline.json (and heap.jsonl if present) and print the same report',
    )
    .argument('<dir>', 'the --out directory of the run')
    .action(guard(subagentsRead));
}
