import { BUILD_BUN_VERSION } from '../binary/bun.ts';
import type { GateOptions } from './run.ts';
import { runGate } from './run.ts';
import type { Gated } from './stamp.ts';
import { assertGated, gateProblem } from './stamp.ts';

export function gatedNow(droidVersion: string): Gated {
  return { droidVersion, bunVersion: BUILD_BUN_VERSION };
}

export function gateProblemNow(droidVersion: string): string | undefined {
  return gateProblem(gatedNow(droidVersion));
}

export function assertGatedNow(droidVersion: string): void {
  assertGated(gatedNow(droidVersion));
}

export async function gate(options: GateOptions): Promise<void> {
  const outcome = await runGate(options);
  if (!outcome.passed) {
    process.exitCode = 1;
  }
}
