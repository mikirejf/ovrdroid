import { setTimeout as delay } from 'node:timers/promises';

import type { RunOptions } from '../cli.ts';
import { mebibytes, messageOf, MS_PER_SECOND, say } from '../cli.ts';
import { interleave, summarise } from './ab.ts';
import { footprintsOf } from './footprint.ts';
import type { IdleReading, Sample } from './idle.ts';
import { formatIdle, parsePs, readIdle } from './idle.ts';
import { sayPaired } from './paired.ts';
import { stdoutOf } from './run.ts';
import { openSettledSession } from './session.ts';
import { treeOf } from './tree.ts';

export const DEFAULT_WINDOW_S = 60;

export interface IdleOptions {
  window: number;
}

export interface IdleCommandOptions extends IdleOptions, RunOptions {}

export interface IdleResult {
  reading: IdleReading;
  bytes: number;
}

async function sampleTree(pids: Iterable<number>, atMs: number): Promise<Sample[]> {
  const listing = await stdoutOf([
    'ps',
    '-o',
    'pid=,utime=,stime=,rss=',
    ...[...pids].flatMap((pid) => ['-p', String(pid)]),
  ]);
  return parsePs(listing, atMs);
}

export async function measureIdle(binary: string, options: IdleOptions): Promise<IdleResult> {
  const { session } = await openSettledSession(binary, { collect: false });

  try {
    const names = await treeOf(session.pid);

    const startedAt = performance.now();
    const head = await sampleTree(names.keys(), performance.now() - startedAt);
    await delay(options.window * MS_PER_SECOND);
    const [tail, footprints] = await Promise.all([
      sampleTree(names.keys(), performance.now() - startedAt),
      footprintsOf(names.keys()),
    ]);

    const reading = readIdle([...head, ...tail], { names, footprints });
    return { reading, bytes: session.bytes() };
  } finally {
    await session.close();
  }
}

export async function idle(binaries: string[], options: IdleCommandOptions): Promise<void> {
  say(`each run waits for the input box, then stands by for ${options.window}s`);

  const results = await interleave(
    binaries,
    async (binary) =>
      await measureIdle(binary, options).catch((error: unknown) => {
        throw new Error(`${binary}: ${messageOf(error)}`);
      }),
    options.runs,
  );

  for (const [binary, runs] of results) {
    const last = runs.at(-1);
    say('');
    say(binary);
    say(
      `  cpu        ${summarise(runs.map((run) => run.reading.cpuMsPerMinute))}  ms per idle minute`,
    );
    say(
      `  footprint  ${summarise(runs.map((run) => mebibytes(run.reading.footprintKib)))}  MB of real memory`,
    );
    say(`  paint      ${summarise(runs.map((run) => run.bytes))}  bytes`);
    if (last !== undefined) {
      say('');
      say(formatIdle(last.reading, last.bytes));
    }
  }

  sayPaired(
    results.map(([binary, runs]) => [binary, runs.map((run) => run.reading.cpuMsPerMinute)]),
    'idle cpu',
  );
  sayPaired(
    results.map(([binary, runs]) => [
      binary,
      runs.map((run) => mebibytes(run.reading.footprintKib)),
    ]),
    'idle footprint (MB)',
  );
}
