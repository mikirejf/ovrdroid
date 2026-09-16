import { readFileSync } from 'node:fs';
import path from 'node:path';

import { appBytes, embedName, ENTRY_FILE, joinApp, readApp } from '../binary/graph.ts';
import { kilobytes, say } from '../cli.ts';
import { patches } from '../patch/patches.ts';
import { formatRebases, rebaseAll, stuckRebases, summariseRebases } from './anchors.ts';

export interface AnchorsOptions {
  json: boolean;
}

export interface ExtractOptions {
  out: string;
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

export function anchors(binary: string, options: AnchorsOptions): void {
  const results = rebaseAll(patches, joinApp(readApp(readFileSync(binary))));
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
