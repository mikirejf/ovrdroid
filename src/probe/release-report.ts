import { readFileSync } from 'node:fs';
import path from 'node:path';

import { appBytes, embedName, ENTRY_FILE, readApp } from '../binary/graph.ts';
import { kilobytes, say } from '../cli.ts';
import { patches } from '../patch/patches.ts';
import { formatRebases, rebaseAll, stuckRebases, summariseRebases } from './anchors.ts';
import {
  describeOrigin,
  describeSearch,
  findPlaces,
  formatPlaces,
  moduleHolding,
  resolveName,
} from './search.ts';

export interface AnchorsOptions {
  json: boolean;
}

export interface ExtractOptions {
  out: string;
}

export interface GrepOptions {
  span: number;
  quiet: boolean;
}

const NAME_CONTEXT_SPAN = 120;

export async function extract(binary: string, options: ExtractOptions): Promise<void> {
  const [entry, ...chunks] = readApp(readFileSync(binary));
  const app = [entry, ...chunks] as const;

  await Promise.all([
    Bun.write(path.join(options.out, ENTRY_FILE), entry.text),
    ...chunks.map(
      async (chunk) => await Bun.write(path.join(options.out, embedName(chunk.name)), chunk.text),
    ),
  ]);

  say(
    `${options.out}: ${app.length} modules, ${kilobytes(appBytes(app))} (${ENTRY_FILE} is the entry point)`,
  );
}

export function grep(binary: string, needle: string, options: GrepOptions): void {
  const search = findPlaces(readApp(readFileSync(binary)), needle, options.span);

  say(describeSearch(search));
  if (!options.quiet && search.places.length > 0) {
    say('');
    say(formatPlaces(search));
  }
}

export function names(binary: string, anchor: string, wanted: readonly string[]): void {
  const module = moduleHolding(readApp(readFileSync(binary)), anchor);
  if (module === undefined) {
    throw new Error(`no module carries that anchor, so its names cannot be resolved: ${anchor}`);
  }

  say(`names as ${embedName(module.name)} sees them, the module the anchor sits in:`);
  say('');
  for (const name of wanted) {
    say(describeOrigin(resolveName(module, name, NAME_CONTEXT_SPAN)));
  }
}

export function anchors(binary: string, options: AnchorsOptions): void {
  const results = rebaseAll(
    patches,
    readApp(readFileSync(binary)).map((module) => module.text),
  );
  if (options.json) {
    say(JSON.stringify(results, null, 2));
    return;
  }

  say(formatRebases(results));
  say('');
  say(summariseRebases(results));

  const stuck = stuckRebases(results);
  if (stuck.length > 0) {
    const stuckNames = stuck.map((result) => result.name).join(', ');
    throw new Error(`${stuck.length} anchors need hand work: ${stuckNames}`);
  }
}
