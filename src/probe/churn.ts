import { chmodSync } from 'node:fs';
import { setTimeout as delay } from 'node:timers/promises';

import { messageOf } from '../cli.ts';
import { CONFIG_FILES } from '../paths.ts';
import type { Session } from './session.ts';
import { openSession } from './session.ts';

export type ChurnKind = 'startup' | 'chmod' | 'none';

export const CHURN_KINDS: readonly ChurnKind[] = ['startup', 'chmod', 'none'];

export const DEFAULT_ROUNDS = 3;
export const DEFAULT_GAP_MS = 6000;

const SETTINGS_MODE = 0o600;

function isMissing(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT';
}

export interface ChurnOptions {
  rounds: number;
  gapMs: number;
  binary: string;
}

export function describeChurn(kind: ChurnKind): string {
  if (kind === 'startup') {
    return 'launching other Droid instances, which is what a second terminal tab does';
  }
  if (kind === 'chmod') {
    return 'a no-op chmod on the config files, the permission fix every Droid does at startup';
  }
  return 'nothing at all, to prove an idle Droid is quiet';
}

async function startupChurn(options: ChurnOptions): Promise<void> {
  const spawned: Session[] = [];
  try {
    for (let round = 0; round < options.rounds; round += 1) {
      // oxlint-disable-next-line no-await-in-loop
      spawned.push(await openSession(options.binary));
      // oxlint-disable-next-line no-await-in-loop
      await delay(options.gapMs);
    }
  } finally {
    await Promise.all(
      spawned.map(async (session) => {
        await session.close();
      }),
    );
  }
}

export function churnOne(file: string): boolean {
  try {
    chmodSync(file, SETTINGS_MODE);
    return true;
  } catch (error) {
    if (isMissing(error)) {
      return false;
    }
    throw new Error(`${file}: cannot chmod, so this round churned nothing: ${messageOf(error)}`, {
      cause: error,
    });
  }
}

async function chmodChurn(options: ChurnOptions): Promise<void> {
  for (let round = 0; round < options.rounds; round += 1) {
    const churned = CONFIG_FILES.filter((file) => churnOne(file));
    if (churned.length === 0) {
      throw new Error(
        `none of the config files exist, so a chmod churns nothing: ${CONFIG_FILES.join(', ')}`,
      );
    }
    // oxlint-disable-next-line no-await-in-loop
    await delay(options.gapMs);
  }
}

export async function induceChurn(kind: ChurnKind, options: ChurnOptions): Promise<void> {
  if (kind === 'none') {
    await delay(options.rounds * options.gapMs);
    return;
  }
  if (kind === 'chmod') {
    await chmodChurn(options);
    return;
  }
  await startupChurn(options);
}
