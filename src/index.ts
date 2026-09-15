#!/usr/bin/env bun
import { copyFileSync, readFileSync, renameSync } from 'node:fs';
import { rm } from 'node:fs/promises';

import { Command } from 'commander';

import pkg from '../package.json' with { type: 'json' };
import { describeStatus, patchSource, statusOf } from './binary/apply.ts';
import { embeddedBunVersion, reportedVersion } from './binary/bun.ts';
import { locateGraph, readSource } from './binary/graph.ts';
import { rebuildInto } from './binary/rebuild.ts';
import { guard, hasErrorCode, kilobytes, messageOf, quitOnBrokenPipe, say } from './cli.ts';
import { applyFix, formatFixed, runDoctor } from './doctor/doctor.ts';
import { installHooks } from './hooks/hooks.ts';
import type { Patch } from './patch/patches.ts';
import { patchSet } from './patch/patches.ts';
import { backupPath, FACTORY_MCP, INSTALLED_DROID } from './paths.ts';

interface Options {
  target: string;
}

interface PatchOptions extends Options {
  devReact: boolean;
}

interface DoctorOptions {
  fix: boolean;
}

function temporaryPath(target: string): string {
  return `${target}.tmp`;
}

function readBinary(target: string): Uint8Array {
  try {
    return readFileSync(target);
  } catch {
    throw new Error(`cannot read target: ${target}`);
  }
}

async function status(options: PatchOptions): Promise<void> {
  const bytes = readBinary(options.target);
  const graph = locateGraph(bytes);
  const list = await patchSet(options);

  say(describeStatus(statusOf(readSource(bytes, graph), list)));
  say(`bun ${embeddedBunVersion(bytes)}`);
  say(
    `source ${graph.source.length} bytes, bytecode ${graph.bytecode.length} bytes, module_info ${graph.moduleInfo.length} bytes`,
  );
}

interface Stock {
  bytes: Uint8Array;
  source: string;
  origin: string;
}

function stockFrom(target: string, list: readonly Patch[]): Stock | undefined {
  const backup = backupPath(target);
  const installed = readBinary(target);
  const source = readSource(installed);
  const current = statusOf(source, list);

  if (current.kind === 'applied') {
    return undefined;
  }
  if (current.kind === 'missing') {
    throw new Error(`markers not found (Droid version drift): ${current.names.join(', ')}`);
  }
  if (current.kind === 'stale') {
    let restored: Uint8Array;
    try {
      restored = readFileSync(backup);
    } catch (error) {
      throw new Error(
        hasErrorCode(error, 'ENOENT')
          ? `target is patched with an older patch set and no backup exists at ${backup}`
          : `target is patched with an older patch set and its backup is unreadable: ${backup} (${messageOf(error)})`,
        { cause: error },
      );
    }
    say(`starting from stock backup ${backup}`);
    return { bytes: restored, source: readSource(restored), origin: backup };
  }

  copyFileSync(target, backup);
  say(`backed up stock binary to ${backup}`);
  return { bytes: installed, source, origin: target };
}

async function apply(options: PatchOptions): Promise<void> {
  const { target } = options;
  const list = await patchSet(options);
  const stocked = stockFrom(target, list);

  if (stocked === undefined) {
    say('already applied');
    runDoctor();
    return;
  }
  const { bytes: stock, source, origin } = stocked;

  const expected = reportedVersion(origin);
  if (expected === '') {
    throw new Error(`cannot read version from ${origin}`);
  }
  const patched = patchSource(source, list);
  say(`patched source: ${list.length} patches plus marker`);

  const temporary = temporaryPath(target);
  try {
    await rebuildInto(stock, patched, temporary);

    const reported = reportedVersion(temporary);
    if (reported !== expected) {
      throw new Error(`patched binary reports ${reported || 'nothing'}, expected ${expected}`);
    }

    renameSync(temporary, target);
    say(`verified ${reported} and installed to ${target}`);
    runDoctor();
  } finally {
    await rm(temporary, { force: true });
  }
}

async function hooks(): Promise<void> {
  for (const installed of await installHooks()) {
    say(`installed ${installed.name} (${kilobytes(installed.bytes)})`);
  }
}

async function update(options: PatchOptions): Promise<void> {
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
  await hooks();
}

function doctor(options: DoctorOptions): void {
  if (!options.fix) {
    runDoctor();
    return;
  }
  const outcome = applyFix();
  if (outcome.fixed.length === 0) {
    say(`doctor: clean (${FACTORY_MCP})`);
    return;
  }
  say(formatFixed(outcome, FACTORY_MCP));
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
const devReactOption = [
  '--dev-react',
  "keep React's development build for full DevTools diagnostics",
  false,
] as const;

program
  .command('status')
  .description('show whether the patch set is applied')
  .option(...targetOption)
  .option(...devReactOption)
  .action(guard(status));

program
  .command('apply')
  .description('patch the source, rebuild the binary on the pinned Bun and install it')
  .option(...targetOption)
  .option(...devReactOption)
  .action(guard(apply));

program
  .command('update')
  .description('run droid update, then apply the patch set if the binary is stock')
  .option(...targetOption)
  .option(...devReactOption)
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
    'rewrite wrapper entries to pinned entry points (backs up mcp.json first)',
    false,
  )
  .action(guard(doctor));

quitOnBrokenPipe();
await program.parseAsync();
