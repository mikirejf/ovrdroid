import type { Command } from 'commander';

import type { RunOptions } from '../cli.ts';
import { count, guard, messageOf, say } from '../cli.ts';
import { interleave } from './ab.ts';
import { sayCounters } from './counters-report.ts';
import { TERMINAL_SIZE } from './launch.ts';
import { sayPaired } from './paired.ts';
import { DEFAULT_TURNS } from './resume-fixture.ts';
import { formatResume, seriesOf } from './resume-report.ts';
import type { ResumeOptions } from './resume.ts';
import { measureResume, QUIET_MS, RESIZE_COLS } from './resume.ts';

const DEFAULT_RESUME_RUNS = 10;

interface ResumeCommandOptions extends ResumeOptions, RunOptions {}

async function resume(binaries: string[], options: ResumeCommandOptions): Promise<void> {
  const layout = { turns: options.turns, quietMs: QUIET_MS, resizeCols: RESIZE_COLS };
  say(
    `each run writes a fresh ${options.turns}-turn session, resumes it in a ${TERMINAL_SIZE.cols}x${TERMINAL_SIZE.rows} terminal, waits for its last reply and ${QUIET_MS}ms of quiet, then times the redraw of a resize to ${RESIZE_COLS} columns`,
  );
  say(
    'cpu is user plus system time from ps (10ms steps), summed over the Droid processes alive at the sample',
  );
  say(
    'a "kept session" warning names the fixture: it existed before Droid started, so the session ledger leaves it, and this probe deletes it itself',
  );

  const results = await interleave(
    binaries,
    async (binary) =>
      await measureResume(binary, options).catch((error: unknown) => {
        throw new Error(`${binary}: ${messageOf(error)}`);
      }),
    options.runs,
  );

  for (const [binary, runs] of results) {
    say('');
    say(binary);
    say(formatResume(runs, layout));
  }

  sayCounters(results);

  if (results.length !== 2) {
    return;
  }
  sayPaired(
    seriesOf(results, (run) => run.paintMs),
    'input box',
  );
  sayPaired(
    seriesOf(results, (run) => run.landedMs),
    'transcript shown',
  );
  sayPaired(
    seriesOf(results, (run) => run.settledMs),
    'settled',
  );
  sayPaired(
    seriesOf(results, (run) => run.cpuMs),
    'resume cpu',
  );
  sayPaired(
    seriesOf(results, (run) => run.redraw.settledMs),
    'resize redraw',
  );
}

export function registerResumeCommands(program: Command): void {
  program
    .command('resume')
    .description(
      'resume a long synthetic session: how long until the transcript and input box show, how much does it draw, and what does a resize redraw cost?',
    )
    .argument('<binaries...>')
    .option('-r, --runs <n>', 'number of interleaved rounds', count, DEFAULT_RESUME_RUNS)
    .option('--turns <n>', 'user and assistant exchanges in the session', count, DEFAULT_TURNS)
    .action(guard(resume));
}
