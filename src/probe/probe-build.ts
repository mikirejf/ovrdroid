import path from 'node:path';

import { patchSource } from '../binary/apply.ts';
import { readSource } from '../binary/graph.ts';
import { rebuildInto } from '../binary/rebuild.ts';
import { say } from '../cli.ts';
import type { Patch } from '../patch/patches.ts';
import { patchSet } from '../patch/patches.ts';
import { modulePatches, tracePatches } from '../patch/trace-patches.ts';
import { watchPatches } from '../patch/watch-patches.ts';
import { backupPath, INSTALLED_DROID, realOrUndefined } from '../paths.ts';

export interface BuildOptions {
  target: string;
  extra?: string;
  trace?: boolean;
  modules?: boolean;
  watch?: boolean;
  devReact: boolean;
  out: string;
}

function isPatch(value: unknown): value is Patch {
  return (
    typeof value === 'object' &&
    value !== null &&
    'name' in value &&
    typeof value.name === 'string' &&
    'find' in value &&
    typeof value.find === 'string' &&
    'replace' in value &&
    typeof value.replace === 'string' &&
    (!('until' in value) || value.until === undefined || typeof value.until === 'string')
  );
}

function isPatchList(value: unknown): value is readonly Patch[] {
  if (!Array.isArray(value)) {
    return false;
  }
  const entries: readonly unknown[] = value;
  return entries.every((entry) => isPatch(entry));
}

export async function readExtra(file: string): Promise<readonly Patch[]> {
  const parsed: unknown = await Bun.file(file).json();
  if (!isPatchList(parsed)) {
    throw new TypeError(`${file}: expected an array of {name, find, replace} strings`);
  }
  return parsed;
}

function resolved(file: string): string {
  return realOrUndefined(file) ?? path.resolve(file);
}

function refuseOverwrite(options: BuildOptions): void {
  const out = resolved(options.out);
  for (const protectedPath of [options.target, INSTALLED_DROID, backupPath(INSTALLED_DROID)]) {
    if (out === resolved(protectedPath)) {
      throw new Error(`refusing to write a probe binary over ${protectedPath}`);
    }
  }
}

export async function buildProbe(options: BuildOptions): Promise<void> {
  refuseOverwrite(options);
  const stock = await Bun.file(options.target).bytes();
  const list: Patch[] = [...(await patchSet(options))];

  if (options.trace === true) {
    list.push(...tracePatches);
  }
  if (options.modules === true) {
    list.push(...modulePatches);
  }
  if (options.watch === true) {
    list.push(...watchPatches);
  }
  if (options.extra !== undefined) {
    list.push(...(await readExtra(options.extra)));
  }

  const patched = patchSource(readSource(stock), list);
  say(`patched source: ${list.length} patches plus marker`);

  const result = await rebuildInto(stock, patched, options.out);
  say(`${options.out} (${result.seconds.toFixed(1)}s)`);
}
