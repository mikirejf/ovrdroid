#!/usr/bin/env bun
import { copyFileSync } from 'node:fs';

import { Command } from 'commander';

import pkg from '../package.json' with { type: 'json' };
import {
  latestVersion,
  parseVersion,
  PINNED_VERSION_FILE,
  pinVersion,
  readPinnedVersion,
} from './binary/droid-release.ts';
import { describeTarget } from './binary/stock.ts';
import { guard, kilobytes, quitOnBrokenPipe, say } from './cli.ts';
import { doctorTargets, runDoctor, runDoctorFix } from './doctor/doctor.ts';
import { assertGatedNow, gate } from './gate/command.ts';
import { installHooks } from './hooks/hooks.ts';
import { applyTo, GATED_HERE, install } from './install.ts';
import { patches } from './patch/patches.ts';
import { backupPath, INSTALLED_DROID } from './paths.ts';

interface Options {
  target: string;
}

interface DoctorOptions {
  fix: boolean;
  project: string;
}

function status(options: Options): void {
  for (const line of describeTarget(options.target, patches)) {
    say(line);
  }
}

async function apply(options: Options): Promise<void> {
  await applyTo(options.target, GATED_HERE);
}

async function hooks(): Promise<void> {
  for (const installed of await installHooks()) {
    say(`installed ${installed.name} (${kilobytes(installed.bytes)})`);
  }
}

async function update(wanted: string | undefined, options: Options): Promise<void> {
  const version = wanted === undefined ? await latestVersion() : parseVersion(wanted);
  await install(version, options.target, GATED_HERE);
  if (options.target === INSTALLED_DROID) {
    assertGatedNow(version);
    pinVersion(version);
    say(`pinned ${version} in ${PINNED_VERSION_FILE}; push it and the Linux hosts follow`);
  }
}

async function sync(options: Options): Promise<void> {
  const version = readPinnedVersion();
  assertGatedNow(version);
  await install(version, options.target, false);
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
  .description(
    'install a Droid release (the newest by default), apply the patch set, and pin that version in droid-version when the target is the installed Droid',
  )
  .argument('[version]', 'Droid version to install, such as 0.236.0')
  .option(...targetOption)
  .action(guard(update));

program
  .command('sync')
  .description(
    'install the Droid version pinned in droid-version and apply the patch set; the Linux hosts run this on a timer',
  )
  .option(...targetOption)
  .action(guard(sync));

program
  .command('gate')
  .description(
    'run every behavioural check on a patched build against its stock build, and write gate-pass.json when all pass; update and apply run it before they install, sync and the pre-push hook refuse a pin it never passed',
  )
  .option(...targetOption)
  .option('--stock <path>', 'stock Droid the target was built from (default: the target .orig)')
  .option(
    '--check-stamp',
    'run nothing: fail unless gate-pass.json covers the pinned droid-version and the current patch set',
    false,
  )
  .action(guard(gate));

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
