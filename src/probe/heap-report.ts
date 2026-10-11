import { MS_PER_SECOND, say } from '../cli.ts';
import {
  formatHeapSummary,
  formatTypeGrowth,
  parseHeap,
  summariseHeap,
  typeGrowth,
} from './heap.ts';

export interface HeapOptions {
  baseline: number;
  from: number | undefined;
  to: number | undefined;
}

export async function heap(file: string, options: HeapOptions): Promise<void> {
  const log = parseHeap(await Bun.file(file).text());
  if (log.series.size === 0) {
    say('no heap rows: was the binary built with --heap and run with OD_HEAP set?');
    return;
  }

  const ordered = [...log.series].toSorted((a, b) => b[1].length - a[1].length);
  for (const [, rows] of ordered) {
    const first = rows.at(0);
    const last = rows.at(-1);
    const summary = summariseHeap(rows, options.baseline * MS_PER_SECOND);
    if (first === undefined || last === undefined || summary === undefined) {
      continue;
    }
    say(formatHeapSummary(summary, first.t));

    const fromT = first.t + (options.from ?? 0) * MS_PER_SECOND;
    const toT = options.to === undefined ? last.t : first.t + options.to * MS_PER_SECOND;
    say(
      `  types that grew from +${((fromT - first.t) / MS_PER_SECOND).toFixed(0)}s to +${((toT - first.t) / MS_PER_SECOND).toFixed(0)}s (top 25 types only):`,
    );
    say(formatTypeGrowth(typeGrowth(rows, { fromMs: fromT, toMs: toT })));
    say('');
  }

  for (const snapshot of log.snapshots) {
    say(
      `snapshot from pid ${snapshot.pid}: ${snapshot.file} (open it in Chrome DevTools, Memory tab)`,
    );
  }
  for (const failure of log.failures) {
    say(`snapshot failed: ${failure}`);
  }
}
