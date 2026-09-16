import { chmodSync, readFileSync } from 'node:fs';

import { say } from '../cli.ts';
import { buildBinary } from './build.ts';
import { BUILD_BUN_VERSION, ensureBun } from './bun.ts';
import { assertSameEmbeds } from './embeds.ts';
import type { App } from './graph.ts';
import { embedName, readApp, readModules } from './graph.ts';
import { assertRefsResolve } from './refs.ts';

const BINARY_MODE = 0o755;

export interface RebuildResult {
  seconds: number;
}

function sign(target: string): void {
  const result = Bun.spawnSync(['codesign', '--force', '--sign', '-', target]);
  if (result.exitCode !== 0) {
    throw new Error(`codesign failed: ${result.stderr.toString().trim()}`);
  }
}

export async function rebuildInto(
  stock: Uint8Array,
  app: App,
  out: string,
): Promise<RebuildResult> {
  const bun = await ensureBun(BUILD_BUN_VERSION);

  say(`building with Bun ${BUILD_BUN_VERSION}`);
  const seconds = await buildBinary({ bun, app, stock, out });
  say(`built in ${seconds.toFixed(1)}s`);

  const rebuilt = readFileSync(out);
  assertSameEmbeds(stock, rebuilt);
  say('verified every embedded file survived the rebuild');

  assertRefsResolve(
    readApp(rebuilt),
    new Set(readModules(rebuilt).map((module) => embedName(module.name))),
  );
  say('verified every embedded path the app addresses resolves');

  chmodSync(out, BINARY_MODE);
  sign(out);
  say('signed');

  return { seconds };
}
