import { BUILD_BUN_VERSION } from '../binary/bun.ts';
import { readPinnedVersion } from '../binary/droid-release.ts';
import { say } from '../cli.ts';
import { markerDigest, patches } from '../patch/patches.ts';
import type { GateOptions } from './run.ts';
import { runGate } from './run.ts';
import type { Gated } from './stamp.ts';
import { assertGated, GATE_STAMP_FILE, gateProblem } from './stamp.ts';

export interface GateCommand extends GateOptions {
  checkStamp: boolean;
}

export function gatedNow(droidVersion: string): Gated {
  return { droidVersion, patchDigest: markerDigest(patches), bunVersion: BUILD_BUN_VERSION };
}

export function gateProblemNow(droidVersion: string): string | undefined {
  return gateProblem(gatedNow(droidVersion));
}

export function assertGatedNow(droidVersion: string): void {
  assertGated(gatedNow(droidVersion));
}

export async function gate(options: GateCommand): Promise<void> {
  if (options.checkStamp) {
    const version = readPinnedVersion();
    assertGatedNow(version);
    say(
      `${GATE_STAMP_FILE} covers pinned Droid ${version} with the current patch set on Bun ${BUILD_BUN_VERSION}`,
    );
    return;
  }
  const outcome = await runGate(options);
  if (!outcome.passed) {
    process.exitCode = 1;
  }
}
