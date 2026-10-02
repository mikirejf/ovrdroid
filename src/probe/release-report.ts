import { readFileSync } from 'node:fs';
import path from 'node:path';

import { cacheStock, latestVersion, RELEASE_HOSTS } from '../binary/droid-release.ts';
import { appBytes, embedName, ENTRY_FILE, readApp } from '../binary/graph.ts';
import { kilobytes, say } from '../cli.ts';
import {
  STOCK_HUB_HEADER,
  STOCK_HUB_METHODS,
  STOCK_PID_HELPERS,
} from '../patch/__tests__/mcp-hub-stock.ts';
import { findMarker, patches } from '../patch/patches.ts';
import { rebaseAll } from '../patch/rebase.ts';
import { holePattern } from '../patch/tokens.ts';
import type { PieceReading } from './align.ts';
import { classHeaderIn, describePiece, methodIn, readPiece } from './align.ts';
import { formatRebases, stuckRebases, summariseRebases } from './anchors.ts';
import { judgeBuild } from './builds.ts';
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

export interface BuildsOptions {
  version?: string;
}

export async function builds(options: BuildsOptions): Promise<void> {
  const version = options.version ?? (await latestVersion());
  const fetched = await Promise.all(
    RELEASE_HOSTS.map(async (host) => ({ host, stock: await cacheStock(version, host) })),
  );

  const drifting: string[] = [];
  for (const {
    host,
    stock: { binary, outcome },
  } of fetched) {
    process.stderr.write(`${host}  ${version}  ${outcome}: ${binary}\n`);
    const rebases = rebaseAll(
      patches,
      readApp(readFileSync(binary)).map((module) => module.text),
    );
    const verdict = judgeBuild(host, version, rebases);
    say(verdict.line);
    if (verdict.drifts) {
      drifting.push(host);
    }
  }

  if (drifting.length > 0) {
    throw new Error(`the patch set drifts on: ${drifting.join(', ')}`);
  }
}

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

const HUB_MEMBER = 'async retryServer(';

export function hub(binary: string): void {
  const app = readApp(readFileSync(binary));
  if (findMarker(app[0].text) !== undefined) {
    throw new Error(
      `${binary} is patched, and the hub fixture is stock code: point this at a stock build (a .orig backup or a probe builds download)`,
    );
  }
  const module = app.find((candidate) => candidate.text.includes(HUB_MEMBER))?.text;
  if (module === undefined) {
    throw new Error(`no module defines the MCP hub (${HUB_MEMBER}); the hub moved or was renamed`);
  }

  const pidHelpers = new RegExp(holePattern(STOCK_PID_HELPERS).source, 'u');
  const readings: [string, PieceReading][] = [
    [
      'pid helpers',
      app.some((candidate) => pidHelpers.test(candidate.text))
        ? { kind: 'same' }
        : { kind: 'missing' },
    ],
    ['class header', readPiece(STOCK_HUB_HEADER, classHeaderIn(module, HUB_MEMBER))],
    ...Object.entries(STOCK_HUB_METHODS).map(([name, text]): [string, PieceReading] => [
      name,
      readPiece(text, methodIn(module, name)),
    ]),
  ];

  for (const [name, reading] of readings) {
    for (const line of describePiece(name, reading)) {
      say(line);
    }
  }

  const moved = readings.filter(([, reading]) => reading.kind !== 'same').map(([name]) => name);
  if (moved.length > 0) {
    throw new Error(
      `${moved.length} hub fixture pieces moved: ${moved.join(', ')}. Update src/patch/__tests__/mcp-hub-stock.ts from the text above`,
    );
  }
}
