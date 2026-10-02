#!/usr/bin/env bun
import { copyFileSync, renameSync, rmSync } from 'node:fs';

import { Command } from 'commander';

import pkg from '../package.json' with { type: 'json' };
import { patchSource } from './binary/apply.ts';
import { reportedVersion } from './binary/bun.ts';
import { cacheStock, latestVersion } from './binary/droid-release.ts';
import { rebuildInto } from './binary/rebuild.ts';
import type { Stock } from './binary/stock.ts';
import { describeTarget, readStock, stockFrom } from './binary/stock.ts';
import { guard, kilobytes, quitOnBrokenPipe, say } from './cli.ts';
import { doctorTargets, runDoctor, runDoctorFix } from './doctor/doctor.ts';
import { installHooks, installSubagentSound } from './hooks/hooks.ts';
import { patches } from './patch/patches.ts';
import { backupPath, INSTALLED_DROID } from './paths.ts';

interface Options {
  target: string;
}

interface DoctorOptions {
  fix: boolean;
  project: string;
}

function temporaryPath(target: string): string {
  return `${target}.tmp`;
}

function status(options: Options): void {
  for (const line of describeTarget(options.target, patches)) {
    say(line);
  }
}

async function installPatched(target: string, stocked: Stock): Promise<void> {
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

    renameSync(temporary, target);
    say(`verified ${reported} and installed to ${target}`);
    say(`installed sound ${installSubagentSound()}`);
    runDoctor(doctorTargets(process.cwd()));
  } finally {
    rmSync(temporary, { force: true });
  }
}

async function apply(options: Options): Promise<void> {
  const { target } = options;
  const stocked = stockFrom(target, patches);

  if (stocked === undefined) {
    say('already applied');
    runDoctor(doctorTargets(process.cwd()));
    return;
  }
  await installPatched(target, stocked);
}

async function hooks(): Promise<void> {
  for (const installed of await installHooks()) {
    say(`installed ${installed.name} (${kilobytes(installed.bytes)})`);
  }
}

async function update(options: Options): Promise<void> {
  const { target } = options;
  const version = await latestVersion();
  if (reportedVersion(target) === version) {
    say(`already on ${version}`);
    await apply(options);
    return;
  }
  const { binary } = await cacheStock(version, `${process.platform}-${process.arch}`);
  const reported = reportedVersion(binary);
  if (reported !== version) {
    throw new Error(`downloaded Droid reports ${reported || 'nothing'}, expected ${version}`);
  }
  await installPatched(target, readStock(binary));
  copyFileSync(binary, backupPath(target));
  say(`updated to ${version}, stock saved to ${backupPath(target)}`);
}

function doctor(options: DoctorOptions): void {
  const targets = doctorTargets(options.project);
  if (options.fix) {
    runDoctorFix(targets);
    return;
  }
  runDoctor(targets);
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
  .name('ovrdroid')
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
  .description('patch the source, rebuild the binary on the pinned Bun and install it')
  .option(...targetOption)
  .action(guard(apply));

program
  .command('update')
  .description('install the newest Droid release, then apply the patch set')
  .option(...targetOption)
  .action(guard(update));

program
  .command('hooks')
  .description('bundle the Droid hooks into ~/.factory/hooks')
  .action(guard(hooks));

program
  .command('restore')
  .description('restore the backup taken before patching')
  .option(...targetOption)
  .action(guard(restore));

program
  .command('doctor')
  .description('report MCP config footguns: problem, impact, fix')
  .option(
    '--fix',
    'rewrite wrapper entries in the user and project mcp.json (backs up a file unless git already holds it)',
    false,
  )
  .option(
    '--project <dir>',
    'directory whose git root holds the project .factory/mcp.json',
    process.cwd(),
  )
  .action(guard(doctor));

quitOnBrokenPipe();
await program.parseAsync();
