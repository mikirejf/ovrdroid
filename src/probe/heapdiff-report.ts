import { say } from '../cli.ts';
import { retainersOf, formatRetainer } from './heap-retainers.ts';
import { formatGrowth, formatNewStrings, formatTotals, growthOf, newStrings } from './heapdiff.ts';
import { parseSnapshot, summarise } from './heapsnapshot.ts';
import type { Snapshot, Summary } from './heapsnapshot.ts';

export const DEFAULT_TOP = 15;
const RETAINED_GROUPS = 5;
const PREFIX_WIDTH = 56;

export interface HeapdiffOptions {
  top: number;
}

async function load(file: string): Promise<{ snapshot: Snapshot; summary: Summary }> {
  const snapshot = parseSnapshot(await Bun.file(file).text());
  return { snapshot, summary: summarise(snapshot) };
}

export async function heapdiff(
  beforeFile: string,
  afterFile: string,
  options: HeapdiffOptions,
): Promise<void> {
  const before = await load(beforeFile);
  const after = await load(afterFile);

  say('totals, before -> after');
  say(formatTotals(before.summary, after.summary));

  const groups = growthOf(before.summary.groups, after.summary.groups, options.top);
  say(`\ngrowth by (type, name), top ${options.top} by self size`);
  say(formatGrowth(groups));

  say(`\nlargest strings that exist only after, top ${options.top}`);
  say(formatNewStrings(newStrings(before.summary, after.summary, options.top)));

  say(`\nstring size grown by first 40 characters, top ${options.top}`);
  say(
    formatGrowth(
      growthOf(before.summary.prefixes, after.summary.prefixes, options.top),
      PREFIX_WIDTH,
    ),
  );

  say(`\nwhat keeps the top ${RETAINED_GROUPS} groups alive (route that gained the most nodes)`);
  const kept = groups.slice(0, RETAINED_GROUPS).map((group) => group.key);
  for (const retainer of retainersOf(before.snapshot, after.snapshot, kept)) {
    say(formatRetainer(retainer));
  }
}
