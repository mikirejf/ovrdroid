import { mkdir, mkdtemp } from 'node:fs/promises';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

import { MS_PER_SECOND, say, seconds } from '../cli.ts';
import type { SelfTime } from './cpuprofile.ts';
import { readProfile, selfTimes } from './cpuprofile.ts';
import { launch } from './launch.ts';
import { openSettledSession, standBy } from './session.ts';

const SELF_TIME_COUNT = 10;
const IDLE_SELF_TIME_COUNT = 12;
const INFLATION_FLOOR = 2;
const MICROS_PER_MS = 1000;
const IDLE_STACK_DEPTH = 4;
const FLUSH_MS = 2000;

export interface CpuOptions {
  out: string;
}

export interface IdleCpuOptions extends CpuOptions {
  window: number;
}

function profileEnv(dir: string) {
  return { BUN_OPTIONS: `--cpu-prof --cpu-prof-interval=250 --cpu-prof-dir=${dir}` };
}

async function profileDir(out: string, prefix: string): Promise<string> {
  await mkdir(out, { recursive: true });
  return await mkdtemp(path.join(out, prefix));
}

function sayEntries(entries: SelfTime[], stackDepth?: number): void {
  for (const entry of entries) {
    const inflated =
      entry.inflation >= INFLATION_FLOOR ? `   ${entry.inflation.toFixed(1)}x inflated` : '';
    say(`${(entry.micros / MICROS_PER_MS).toFixed(1)}ms  ${entry.samples} samples${inflated}`);
    const stack = stackDepth === undefined ? entry.stack : entry.stack.slice(0, stackDepth);
    for (const frame of stack) {
      say(`  ${frame}`);
    }
  }
}

export async function cpu(binary: string, options: CpuOptions): Promise<void> {
  const dir = await profileDir(options.out, 'run-');
  const timing = await launch(binary, { env: profileEnv(dir) });
  say(`paint ${seconds(timing.paintMs)}  dir ${dir}`);

  const found = await readProfile(dir, timing.pid);
  say(`profile ${found.name} (${found.written} written; droid spawns a second droid)`);

  const cutMicros = timing.paintMs * MICROS_PER_MS;
  const durationMicros = found.profile.endTime - found.profile.startTime;
  say(
    cutMicros >= durationMicros
      ? `no cut: paint at ${(cutMicros / MICROS_PER_MS).toFixed(0)}ms is past the ${(durationMicros / MICROS_PER_MS).toFixed(0)}ms profiled, so post-paint work is included`
      : `cut at ${(cutMicros / MICROS_PER_MS).toFixed(0)}ms of ${(durationMicros / MICROS_PER_MS).toFixed(0)}ms profiled (${((cutMicros / durationMicros) * 100).toFixed(0)}%)`,
  );

  const report = selfTimes(found.profile, SELF_TIME_COUNT, { untilMicros: cutMicros });
  say(
    `sampling period ${(report.periodMicros / MICROS_PER_MS).toFixed(2)}ms (median), ${report.sampleCount} samples`,
  );
  say(
    `${(report.chargedMicros / MICROS_PER_MS).toFixed(1)}ms estimated CPU, ${(report.rawMicros / MICROS_PER_MS).toFixed(1)}ms of wall time in the window`,
  );
  sayEntries(report.entries);
}

export async function idleCpu(binary: string, options: IdleCpuOptions): Promise<void> {
  const dir = await profileDir(options.out, 'idle-');
  const { session, settledAt } = await openSettledSession(binary, {
    env: profileEnv(dir),
    signal: 'SIGINT',
    collect: false,
  });

  try {
    await standBy(options.window);

    const idleFromMicros = (settledAt - session.startedAt) * MICROS_PER_MS;
    const bytes = session.bytes();
    await session.close();
    await delay(FLUSH_MS);

    const found = await readProfile(dir, session.pid);
    const report = selfTimes(found.profile, IDLE_SELF_TIME_COUNT, { fromMicros: idleFromMicros });

    say('');
    say(`profile ${found.name} (${found.written} written; droid spawns a second droid)`);
    say(
      `idle window starts at ${(idleFromMicros / MICROS_PER_MS / MS_PER_SECOND).toFixed(1)}s, ${report.sampleCount} samples`,
    );
    say(
      `${(report.chargedMicros / MICROS_PER_MS).toFixed(0)}ms of CPU while idle, ${bytes} bytes painted`,
    );
    say('');
    sayEntries(report.entries, IDLE_STACK_DEPTH);
  } finally {
    await session.close();
  }
}
