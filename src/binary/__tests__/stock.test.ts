import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { chmodSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import type { Patch } from '../../patch/patches.ts';
import { markerStatement } from '../../patch/patches.ts';
import { backupPath } from '../../paths.ts';
import { makeTempDir } from '../../temp.ts';
import { stockFrom } from '../stock.ts';
import { build, entry } from './binary.ts';

const list: readonly Patch[] = [{ name: 'timeout', find: 'wait(150)', replace: 'wait(30)' }];
const older: readonly Patch[] = [{ name: 'timeout', find: 'wait(150)', replace: 'wait(1)' }];

const STOCK_SOURCE = 'wait(150);done();';
const PATCHED_SOURCE = `${STOCK_SOURCE}${markerStatement(older)}`;

function droidReporting(version: string, source: string): Uint8Array {
  const script = Buffer.from(`#!/bin/sh\necho ${version}\nexit 0\n`);
  return build([{ ...entry, source }], 0, script);
}

function install(file: string, bytes: Uint8Array): void {
  writeFileSync(file, bytes);
  chmodSync(file, 0o755);
}

describe('stockFrom', () => {
  let dir = '';
  let target = '';
  let backup = '';

  beforeEach(() => {
    dir = makeTempDir('stock-test');
    target = path.join(dir, 'droid');
    backup = backupPath(target);
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  test('rebuilds from the backup when it is the same Droid version as the stale target', () => {
    const stock = droidReporting('0.228.0', STOCK_SOURCE);
    install(target, droidReporting('0.228.0', PATCHED_SOURCE));
    install(backup, stock);

    const stocked = stockFrom(target, list);

    expect(stocked?.origin).toBe(backup);
    expect(Buffer.from(stocked?.bytes ?? []).equals(Buffer.from(stock))).toBe(true);
  });

  test('refuses a backup from a different Droid version and leaves both files alone', () => {
    install(target, droidReporting('0.228.0', PATCHED_SOURCE));
    install(backup, droidReporting('0.227.0', STOCK_SOURCE));
    const targetBefore = readFileSync(target);
    const backupBefore = readFileSync(backup);

    expect(() => stockFrom(target, list)).toThrow(
      `stock backup ${backup} is Droid 0.227.0 but ${target} is 0.228.0; refusing to rebuild from a different version`,
    );
    expect(readFileSync(target).equals(targetBefore)).toBe(true);
    expect(readFileSync(backup).equals(backupBefore)).toBe(true);
  });

  test('backs up an unpatched target and starts from it', () => {
    const stock = droidReporting('0.228.0', STOCK_SOURCE);
    install(target, stock);

    const stocked = stockFrom(target, list);

    expect(stocked?.origin).toBe(target);
    expect(readFileSync(backup).equals(Buffer.from(stock))).toBe(true);
  });
});
