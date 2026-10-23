import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { hasErrorCode } from '../cli.ts';

export const GATE_STAMP_FILE = path.join(import.meta.dir, '..', '..', 'gate-pass.json');

export interface Gated {
  droidVersion: string;
  bunVersion: string;
}

export interface GateStamp extends Gated {
  patchDigest: string;
  platform: string;
  passedAt: string;
  checks: string[];
}

function isStringList(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === 'string');
}

function isStamp(value: unknown): value is GateStamp {
  return (
    typeof value === 'object' &&
    value !== null &&
    'droidVersion' in value &&
    typeof value.droidVersion === 'string' &&
    'patchDigest' in value &&
    typeof value.patchDigest === 'string' &&
    'bunVersion' in value &&
    typeof value.bunVersion === 'string' &&
    'platform' in value &&
    typeof value.platform === 'string' &&
    'passedAt' in value &&
    typeof value.passedAt === 'string' &&
    'checks' in value &&
    isStringList(value.checks)
  );
}

export function parseStamp(text: string): GateStamp | undefined {
  try {
    const parsed: unknown = JSON.parse(text);
    return isStamp(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

export function stampProblem(
  stampText: string | undefined,
  expected: Gated,
  file: string,
): string | undefined {
  const never = `Droid ${expected.droidVersion} was never gated on Bun ${expected.bunVersion}`;
  if (stampText === undefined) {
    return `${never}: ${file} does not exist; run \`ovrdroid update\` or \`ovrdroid gate\` on the Mac`;
  }
  const stamp = parseStamp(stampText);
  if (stamp === undefined) {
    return `${never}: ${file} is not a gate stamp`;
  }
  if (stamp.droidVersion !== expected.droidVersion) {
    return `${never}: ${file} records Droid ${stamp.droidVersion}`;
  }
  if (stamp.bunVersion !== expected.bunVersion) {
    return `${never}: ${file} records Bun ${stamp.bunVersion}`;
  }
  return undefined;
}

function readStampText(file: string): string | undefined {
  try {
    return readFileSync(file, 'utf-8');
  } catch (error) {
    if (hasErrorCode(error, 'ENOENT')) {
      return undefined;
    }
    throw error;
  }
}

export function gateProblem(expected: Gated, file: string = GATE_STAMP_FILE): string | undefined {
  return stampProblem(readStampText(file), expected, file);
}

export function assertGated(expected: Gated, file: string = GATE_STAMP_FILE): void {
  const problem = gateProblem(expected, file);
  if (problem !== undefined) {
    throw new Error(problem);
  }
}

export function writeStamp(stamp: GateStamp, file: string = GATE_STAMP_FILE): void {
  writeFileSync(file, `${JSON.stringify(stamp, null, 2)}\n`);
}
