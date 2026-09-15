import { readFileSync } from 'node:fs';

import { readSource } from '../binary/graph.ts';
import { say } from '../cli.ts';
import { patchSet } from '../patch/patches.ts';
import { formatRebases, rebaseAll, stuckRebases, summariseRebases } from './anchors.ts';

export interface AnchorsOptions {
  json: boolean;
}

export async function anchors(binary: string, options: AnchorsOptions): Promise<void> {
  const list = await patchSet({ devReact: false });
  const results = rebaseAll(list, readSource(readFileSync(binary)));
  if (options.json) {
    say(JSON.stringify(results, null, 2));
    return;
  }

  say(formatRebases(results));
  say('');
  say(summariseRebases(results));

  const stuck = stuckRebases(results);
  if (stuck.length > 0) {
    const names = stuck.map((result) => result.name).join(', ');
    throw new Error(`${stuck.length} anchors need hand work: ${names}`);
  }
}
