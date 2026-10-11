import { appendFileSync, writeFileSync } from 'node:fs';
import { setTimeout as delay } from 'node:timers/promises';

import { MS_PER_SECOND, say } from '../cli.ts';
import { footprintsOf } from './footprint.ts';
import { stdoutOf } from './run.ts';
import type { Tick } from './sampler.ts';
import {
  formatSummary,
  PS_COLUMNS,
  readTick,
  serialiseFootprints,
  serialiseTick,
  summariseTicks,
  threadCount,
  withFootprints,
} from './sampler.ts';

export const DEFAULT_INTERVAL_MS = 1000;
export const DEFAULT_FOOTPRINT_EVERY = 1;

export interface SamplerOptions {
  intervalMs: number;
  footprintEvery: number;
  out?: string | undefined;
}

export interface Sampler {
  ticks: () => readonly Tick[];
  stop: () => Promise<Tick[]>;
  finished: Promise<void>;
}

async function takeTick(root: number): Promise<Tick | undefined> {
  const [listing, threads] = await Promise.all([
    stdoutOf(['ps', '-Ao', PS_COLUMNS]),
    stdoutOf(['ps', '-M', '-p', String(root)], { quiet: true }),
  ]);
  return readTick(listing, { root, atMs: Date.now(), threads: threadCount(threads) });
}

export function startSampler(root: number, options: SamplerOptions): Sampler {
  const ticks: Tick[] = [];
  const cancel = new AbortController();
  const record = (line: string): void => {
    if (options.out !== undefined) {
      appendFileSync(options.out, `${line}\n`);
    }
  };
  if (options.out !== undefined) {
    writeFileSync(options.out, '');
  }

  const run = async (): Promise<void> => {
    const begun = performance.now();
    for (let n = 0; !cancel.signal.aborted; n += 1) {
      // oxlint-disable-next-line no-await-in-loop
      const taken = await takeTick(root);
      if (taken === undefined) {
        return;
      }
      record(serialiseTick(taken));
      let tick = taken;
      if (options.footprintEvery > 0 && n % options.footprintEvery === 0) {
        const footprints = footprintsOf(taken.processes.map((process) => process.pid));
        record(serialiseFootprints(taken.atMs, footprints));
        tick = withFootprints(taken, footprints);
      }
      ticks.push(tick);
      const wait = begun + (n + 1) * options.intervalMs - performance.now();
      try {
        // oxlint-disable-next-line no-await-in-loop
        await delay(Math.max(0, wait), undefined, { signal: cancel.signal });
      } catch {
        return;
      }
    }
  };

  const finished = run();

  return {
    ticks: () => ticks,
    async stop() {
      cancel.abort();
      await finished;
      return ticks;
    },
    finished,
  };
}

export interface SampleCommandOptions {
  interval: number;
  duration: number | undefined;
  footprintEvery: number;
  out: string | undefined;
}

export async function sample(pidText: string, options: SampleCommandOptions): Promise<void> {
  const root = Number(pidText);
  if (!Number.isInteger(root) || root < 1) {
    throw new Error(`${pidText} is not a process id`);
  }

  const sampler = startSampler(root, {
    intervalMs: options.interval,
    footprintEvery: options.footprintEvery,
    out: options.out,
  });
  const stopOnSignal = (): void => {
    void sampler.stop();
  };
  process.once('SIGINT', stopOnSignal);
  const timer =
    options.duration === undefined
      ? undefined
      : setTimeout(stopOnSignal, options.duration * MS_PER_SECOND);

  say(
    `sampling pid ${root} every ${options.interval}ms${options.duration === undefined ? ' until it exits or Ctrl-C' : ` for ${options.duration}s`}`,
  );
  await sampler.finished;
  clearTimeout(timer);
  process.off('SIGINT', stopOnSignal);

  const summary = summariseTicks(sampler.ticks());
  if (summary === undefined) {
    throw new Error(`pid ${root} was not running`);
  }
  say('');
  say(formatSummary(summary));
  if (options.out !== undefined) {
    say(`ticks written to ${options.out}`);
  }
}
