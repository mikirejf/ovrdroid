import { copyFileSync, renameSync, rmSync } from 'node:fs';

import { patchSource } from './binary/apply.ts';
import { reportedVersion } from './binary/bun.ts';
import { cacheStock } from './binary/droid-release.ts';
import { rebuildInto } from './binary/rebuild.ts';
import type { Stock } from './binary/stock.ts';
import { readStock, stockFrom } from './binary/stock.ts';
import { say } from './cli.ts';
import { doctorTargets, runDoctor } from './doctor/doctor.ts';
import { gatedNow, gateProblemNow } from './gate/command.ts';
import { runGate } from './gate/run.ts';
import { installSubagentSound } from './hooks/hooks.ts';
import { patches } from './patch/patches.ts';
import { backupPath } from './paths.ts';

export const GATED_HERE = process.platform === 'darwin';

function temporaryPath(target: string): string {
  return `${target}.tmp`;
}

async function passGate(candidate: string, stock: string, version: string): Promise<void> {
  const covered = gatedNow(version);
  if (gateProblemNow(version) === undefined) {
    say(
      `gate: gate-pass.json already covers Droid ${covered.droidVersion}, patch set ${covered.patchDigest}, Bun ${covered.bunVersion}; not running it again`,
    );
    return;
  }
  const outcome = await runGate({ target: candidate, stock });
  if (!outcome.passed) {
    throw new Error(
      `the gate failed, so nothing was installed or pinned; logs are in ${outcome.logDir}`,
    );
  }
}

async function installPatched(target: string, stocked: Stock, gated: boolean): Promise<void> {
  const { bytes: stock, app, origin } = stocked;

  const expected = reportedVersion(origin);
  if (expected === '') {
    throw new Error(`cannot read version from ${origin}`);
  }
  const patched = patchSource(app, patches);
  say(`patched source: ${patches.length} patches plus marker`);

  const temporary = temporaryPath(target);
  try {
    await rebuildInto(stock, patched, temporary);

    const reported = reportedVersion(temporary);
    if (reported !== expected) {
      throw new Error(`patched binary reports ${reported || 'nothing'}, expected ${expected}`);
    }

    if (gated) {
      await passGate(temporary, origin, expected);
    }

    renameSync(temporary, target);
    say(`verified ${reported} and installed to ${target}`);
    say(`installed sound ${installSubagentSound()}`);
    runDoctor(doctorTargets(process.cwd()));
  } finally {
    rmSync(temporary, { force: true });
  }
}

export async function applyTo(target: string, gated: boolean): Promise<void> {
  const stocked = stockFrom(target, patches);

  if (stocked === undefined) {
    say('already applied');
    runDoctor(doctorTargets(process.cwd()));
    return;
  }
  await installPatched(target, stocked, gated);
}

export async function install(version: string, target: string, gated: boolean): Promise<void> {
  if (reportedVersion(target) === version) {
    say(`already on ${version}`);
    await applyTo(target, gated);
    return;
  }
  const { binary } = await cacheStock(version, `${process.platform}-${process.arch}`);
  const reported = reportedVersion(binary);
  if (reported !== version) {
    throw new Error(`downloaded Droid reports ${reported || 'nothing'}, expected ${version}`);
  }
  await installPatched(target, readStock(binary), gated);
  copyFileSync(binary, backupPath(target));
  say(`updated to ${version}, stock saved to ${backupPath(target)}`);
}
