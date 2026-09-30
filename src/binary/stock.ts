import { copyFileSync, readFileSync } from 'node:fs';

import { hasErrorCode, kilobytes, messageOf, say } from '../cli.ts';
import type { Patch } from '../patch/patches.ts';
import { backupPath } from '../paths.ts';
import { describeStatus, statusOf } from './apply.ts';
import { embeddedBunVersion, reportedVersion } from './bun.ts';
import type { App } from './graph.ts';
import { appBytes, readApp } from './graph.ts';

export interface Stock {
  bytes: Uint8Array;
  app: App;
  origin: string;
}

function readBinary(target: string): Uint8Array {
  try {
    return readFileSync(target);
  } catch {
    throw new Error(`cannot read target: ${target}`);
  }
}

export function readStock(origin: string): Stock {
  const bytes = readBinary(origin);
  return { bytes, app: readApp(bytes), origin };
}

export function describeTarget(target: string, list: readonly Patch[]): string[] {
  const { bytes, app } = readStock(target);
  return [
    describeStatus(statusOf(app, list)),
    `bun ${embeddedBunVersion(bytes)}`,
    `source ${kilobytes(appBytes(app))} across ${app.length} modules`,
  ];
}

function readBackup(backup: string): Uint8Array {
  try {
    return readFileSync(backup);
  } catch (error) {
    throw new Error(
      hasErrorCode(error, 'ENOENT')
        ? `target is patched with an older patch set and no backup exists at ${backup}`
        : `target is patched with an older patch set and its backup is unreadable: ${backup} (${messageOf(error)})`,
      { cause: error },
    );
  }
}

function assertSameVersion(backup: string, target: string): void {
  const backupVersion = reportedVersion(backup);
  const targetVersion = reportedVersion(target);
  if (backupVersion !== targetVersion) {
    throw new Error(
      `stock backup ${backup} is Droid ${backupVersion || 'unknown'} but ${target} is ${targetVersion || 'unknown'}; refusing to rebuild from a different version`,
    );
  }
}

export function stockFrom(target: string, list: readonly Patch[]): Stock | undefined {
  const backup = backupPath(target);
  const installed = readStock(target);
  const current = statusOf(installed.app, list);

  if (current.kind === 'applied') {
    return undefined;
  }
  if (current.kind === 'missing') {
    throw new Error(`markers not found (Droid version drift): ${current.names.join(', ')}`);
  }
  if (current.kind === 'stale') {
    const restored = readBackup(backup);
    assertSameVersion(backup, target);
    say(`starting from stock backup ${backup}`);
    return { bytes: restored, app: readApp(restored), origin: backup };
  }

  copyFileSync(target, backup);
  say(`backed up stock binary to ${backup}`);
  return installed;
}
