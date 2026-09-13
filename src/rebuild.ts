import { chmodSync } from 'node:fs';

import { buildBinary } from './build.ts';
import { embeddedBunVersion, ensureBun } from './bun.ts';
import { say } from './cli.ts';
import { transplantInto } from './graph.ts';

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
  source: string,
  out: string,
): Promise<RebuildResult> {
  const bunVersion = embeddedBunVersion(stock);
  say(`embedded Bun ${bunVersion}`);

  const bun = await ensureBun(bunVersion);
  say(`using Bun runtime ${bun}`);

  say('building (this takes ~11s and ~3GB of RAM)');
  const built = await buildBinary(bun, source);
  say(`built in ${built.seconds.toFixed(1)}s`);

  transplantInto(stock, built.bytes);
  say('transplanted source, bytecode and module_info');

  await Bun.write(out, stock);
  chmodSync(out, BINARY_MODE);
  sign(out);
  say('signed');

  return { seconds: built.seconds };
}
