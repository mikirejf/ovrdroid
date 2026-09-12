#!/usr/bin/env bun
import { chmodSync, copyFileSync, renameSync, statSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';

import { Command } from 'commander';

import pkg from '../package.json' with { type: 'json' };
import { describeStatus, patchSource, statusOf } from './apply.ts';
import { buildBinary } from './build.ts';
import { embeddedBunVersion, ensureBun, reportedVersion } from './bun.ts';
import { locateGraph, readSource, transplantInto } from './graph.ts';
import { patches } from './patches.ts';

const DEFAULT_TARGET = path.join(homedir(), '.local', 'bin', 'droid');

interface Options {
  target: string;
}

function fail(message: string): never {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}

function say(message: string): void {
  process.stdout.write(`${message}\n`);
}

function backupPath(target: string): string {
  return `${target}.orig`;
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

function sign(target: string): void {
  const result = Bun.spawnSync(['codesign', '--force', '--sign', '-', target]);
  if (result.exitCode !== 0) {
    throw new Error(`codesign failed: ${result.stderr.toString().trim()}`);
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

  const bunVersion = embeddedBunVersion(stock);
  say(`embedded Bun ${bunVersion}`);
  const bunReady = ensureBun(bunVersion);

  const expected = reportedVersion(origin);
  const patched = patchSource(readSource(stock), patches);
  say(`patched source: ${patches.length} patches plus marker`);

  const bun = await bunReady;
  say(`using Bun runtime ${bun}`);

  say('building (this takes ~11s and ~3GB of RAM)');
  const built = await buildBinary(bun, patched);
  say(`built in ${built.seconds.toFixed(1)}s`);

  transplantInto(stock, built.bytes);
  say('transplanted source, bytecode and module_info');

  const temporary = temporaryPath(target);
  try {
    await Bun.write(temporary, stock);
    chmodSync(temporary, statSync(target).mode);
    sign(temporary);
    say('signed');

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

function guard<T>(action: (options: T) => void | Promise<void>) {
  return async (options: T): Promise<void> => {
    try {
      await action(options);
    } catch (error) {
      fail(error instanceof Error ? error.message : String(error));
    }
  };
}

const program = new Command()
  .name('overdroid')
  .description('Patch harness for the Droid CLI binary')
  .version(pkg.version);

const targetOption = ['-t, --target <path>', 'path to the Droid binary', DEFAULT_TARGET] as const;

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
