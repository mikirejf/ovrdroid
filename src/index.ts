#!/usr/bin/env bun
import { copyFileSync, renameSync } from 'node:fs';
import { rm } from 'node:fs/promises';

import { Command } from 'commander';

import pkg from '../package.json' with { type: 'json' };
import { describeStatus, patchSource, statusOf } from './apply.ts';
import { embeddedBunVersion, reportedVersion } from './bun.ts';
import { guard, say } from './cli.ts';
import { locateGraph, readSource } from './graph.ts';
import { patches } from './patches.ts';
import { backupPath, INSTALLED_DROID } from './paths.ts';
import { rebuildInto } from './rebuild.ts';

interface Options {
  target: string;
}

function temporaryPath(target: string): string {
  return `${target}.tmp`;
}

async function readBinary(target: string): Promise<Uint8Array> {
  try {
    return await Bun.file(target).bytes();
  } catch {
    throw new Error(`cannot read target: ${target}`);
  }
}

async function status(options: Options): Promise<void> {
  const bytes = await readBinary(options.target);
  const graph = locateGraph(bytes);

  say(describeStatus(statusOf(readSource(bytes, graph), patches)));
  say(`bun ${embeddedBunVersion(bytes)}`);
  say(
    `source ${graph.source.length} bytes, bytecode ${graph.bytecode.length} bytes, module_info ${graph.moduleInfo.length} bytes`,
  );
}

interface Stock {
  bytes: Uint8Array;
  origin: string;
}

async function stockFrom(target: string): Promise<Stock | undefined> {
  const backup = backupPath(target);
  const installed = await readBinary(target);
  const current = statusOf(readSource(installed), patches);

  if (current.kind === 'applied') {
    return undefined;
  }
  if (current.kind === 'missing') {
    throw new Error(`markers not found (Droid version drift): ${current.names.join(', ')}`);
  }
  if (current.kind === 'stale') {
    if (!(await Bun.file(backup).exists())) {
      throw new Error(
        `target is patched with an older patch set and no backup exists at ${backup}`,
      );
    }
    say(`starting from stock backup ${backup}`);
    return { bytes: await readBinary(backup), origin: backup };
  }

  copyFileSync(target, backup);
  say(`backed up stock binary to ${backup}`);
  return { bytes: installed, origin: target };
}

async function apply(options: Options): Promise<void> {
  const { target } = options;
  const stocked = await stockFrom(target);

  if (stocked === undefined) {
    say('already applied');
    return;
  }
  const { bytes: stock, origin } = stocked;

  const expected = reportedVersion(origin);
  const patched = patchSource(readSource(stock), patches);
  say(`patched source: ${patches.length} patches plus marker`);

  const temporary = temporaryPath(target);
  try {
    await rebuildInto(stock, patched, temporary);

    const reported = reportedVersion(temporary);
    if (reported !== expected) {
      throw new Error(`patched binary reports ${reported || 'nothing'}, expected ${expected}`);
    }

    renameSync(temporary, target);
    say(`verified ${reported} and installed to ${target}`);
  } finally {
    await rm(temporary, { force: true });
  }
}

async function update(options: Options): Promise<void> {
  const { FACTORY_DROID_AUTO_UPDATE_ENABLED: _, ...env } = Bun.env;
  const before = reportedVersion(options.target);
  const result = Bun.spawnSync([options.target, 'update'], {
    env,
    stdout: 'inherit',
    stderr: 'inherit',
  });
  if (result.exitCode !== 0) {
    throw new Error(`droid update exited with ${result.exitCode}`);
  }

  const after = reportedVersion(options.target);
  say(after === before ? `still ${after}` : `updated ${before} -> ${after}`);
  await apply(options);
}

function restore(options: Options): void {
  const backup = backupPath(options.target);
  try {
    copyFileSync(backup, options.target);
  } catch {
    throw new Error(`no backup found: ${backup}`);
  }
  say(`restored ${options.target} from ${backup}`);
}

const program = new Command()
  .name('overdroid')
  .description('Patch harness for the Droid CLI binary')
  .version(pkg.version);

const targetOption = ['-t, --target <path>', 'path to the Droid binary', INSTALLED_DROID] as const;

program
  .command('status')
  .description('show whether the patch set is applied')
  .option(...targetOption)
  .action(guard(status));

program
  .command('apply')
  .description('patch the source, rebuild it and transplant it into the binary')
  .option(...targetOption)
  .action(guard(apply));

program
  .command('update')
  .description('run droid update, then apply the patch set if the binary is stock')
  .option(...targetOption)
  .action(guard(update));

program
  .command('restore')
  .description('restore the backup taken before patching')
  .option(...targetOption)
  .action(guard(restore));

await program.parseAsync();
