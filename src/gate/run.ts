import { mkdirSync, rmSync } from 'node:fs';
import path from 'node:path';

import { statusOf } from '../binary/apply.ts';
import { BUILD_BUN_VERSION, embeddedBunVersion, reportedVersion } from '../binary/bun.ts';
import { readStock } from '../binary/stock.ts';
import { say } from '../cli.ts';
import { markerDigest, patches } from '../patch/patches.ts';
import { backupPath, cacheDir } from '../paths.ts';
import { makeTempDir } from '../temp.ts';
import { gateChecks } from './checks.ts';
import { executeGate } from './execute.ts';
import { fillScratchHome } from './scratch-home.ts';
import type { Gated } from './stamp.ts';
import { writeStamp } from './stamp.ts';

export interface GateOptions {
  target: string;
  stock?: string | undefined;
}

function platformName(): string {
  return `${process.platform}-${process.arch}`;
}

interface GatedBuild extends Gated {
  patchDigest: string;
}

function gatedBuild(target: string, stock: string): GatedBuild {
  const patchDigest = markerDigest(patches);
  const built = readStock(target);
  const status = statusOf(built.app, patches);
  if (status.kind !== 'applied') {
    throw new Error(
      `${target} does not carry the current patch set ${patchDigest}: ${status.kind}`,
    );
  }
  const bunVersion = embeddedBunVersion(built.bytes);
  if (bunVersion !== BUILD_BUN_VERSION) {
    throw new Error(
      `${target} is built on Bun ${bunVersion}, the pinned build Bun is ${BUILD_BUN_VERSION}`,
    );
  }
  const droidVersion = reportedVersion(target);
  const stockVersion = reportedVersion(stock);
  if (droidVersion === '' || droidVersion !== stockVersion) {
    throw new Error(
      `${target} reports ${droidVersion || 'nothing'} but the stock ${stock} reports ${stockVersion || 'nothing'}`,
    );
  }
  return { droidVersion, patchDigest, bunVersion };
}

export interface GateOutcome {
  passed: boolean;
  logDir: string;
}

export async function runGate(options: GateOptions): Promise<GateOutcome> {
  const { target } = options;
  const stock = options.stock ?? backupPath(target);
  const gated = gatedBuild(target, stock);
  const logDir = cacheDir('gate', `${gated.droidVersion}-${gated.patchDigest}`);
  mkdirSync(logDir, { recursive: true });

  const scratchHome = makeTempDir('gate-home');
  const bodiesBuild = path.join(logDir, 'droid-bodies');
  try {
    const phases = gateChecks({
      ...fillScratchHome(scratchHome, { target, stock }),
      droidVersion: gated.droidVersion,
      scratchHome,
      bodiesBuild,
    });
    say(
      `gate: Droid ${gated.droidVersion} with patch set ${gated.patchDigest} on Bun ${gated.bunVersion}`,
    );

    const executed = await executeGate(phases, logDir);
    if (executed.passed) {
      writeStamp({
        ...gated,
        platform: platformName(),
        passedAt: new Date().toISOString(),
        checks: executed.names,
      });
    }
    return { passed: executed.passed, logDir };
  } finally {
    rmSync(scratchHome, { recursive: true, force: true });
    rmSync(bodiesBuild, { force: true });
  }
}
