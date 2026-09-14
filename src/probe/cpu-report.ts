import { mkdir, mkdtemp } from 'node:fs/promises';
import path from 'node:path';

import { say, seconds } from '../cli.ts';
import { readProfile, selfTimes } from './cpuprofile.ts';
import { launch } from './launch.ts';

const SELF_TIME_COUNT = 10;
const INFLATION_FLOOR = 2;

export interface CpuOptions {
  out: string;
}

export async function cpu(binary: string, options: CpuOptions): Promise<void> {
  await mkdir(options.out, { recursive: true });
  const dir = await mkdtemp(path.join(options.out, 'run-'));
  const timing = await launch(binary, {
    env: { BUN_OPTIONS: `--cpu-prof --cpu-prof-interval=250 --cpu-prof-dir=${dir}` },
  });
  say(`paint ${seconds(timing.paintMs)}  dir ${dir}`);

  const found = await readProfile(dir, timing.pid);
  say(`profile ${found.name} (${found.written} written; droid spawns a second droid)`);

  const cutMicros = timing.paintMs * 1000;
  const durationMicros = found.profile.endTime - found.profile.startTime;
  say(
    cutMicros >= durationMicros
      ? `no cut: paint at ${(cutMicros / 1000).toFixed(0)}ms is past the ${(durationMicros / 1000).toFixed(0)}ms profiled, so post-paint work is included`
      : `cut at ${(cutMicros / 1000).toFixed(0)}ms of ${(durationMicros / 1000).toFixed(0)}ms profiled (${((cutMicros / durationMicros) * 100).toFixed(0)}%)`,
  );

  const report = selfTimes(found.profile, SELF_TIME_COUNT, cutMicros);
  say(
    `sampling period ${(report.periodMicros / 1000).toFixed(2)}ms (median), ${report.sampleCount} samples`,
  );
  say(
    `${(report.chargedMicros / 1000).toFixed(1)}ms estimated CPU, ${(report.rawMicros / 1000).toFixed(1)}ms of wall time in the window`,
  );
  for (const entry of report.entries) {
    const inflated =
      entry.inflation >= INFLATION_FLOOR ? `   ${entry.inflation.toFixed(1)}x inflated` : '';
    say(`${(entry.micros / 1000).toFixed(1)}ms  ${entry.samples} samples${inflated}`);
    for (const frame of entry.stack) {
      say(`  ${frame}`);
    }
  }
}
