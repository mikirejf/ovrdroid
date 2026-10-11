import { describe, expect, test } from 'bun:test';

import {
  HEAP_ANCHOR,
  HEAP_INTERVAL_VARIABLE,
  HEAP_SNAPSHOT_SIGNAL,
  HEAP_TYPES_VARIABLE,
  HEAP_VARIABLE,
  heapPatches,
} from '../../patch/heap-patches.ts';
import {
  formatHeapSummary,
  formatTypeGrowth,
  mainPid,
  parseHeap,
  summariseHeap,
  typeGrowth,
} from '../heap.ts';

const MB = 1024 * 1024;

function fail(): never {
  throw new Error('expected a summary');
}

interface RowOptions {
  t: number;
  pid?: number;
  rss: number;
  top?: Record<string, number>;
  objects?: number;
}

function row(options: RowOptions): string {
  return JSON.stringify({
    t: options.t,
    pid: options.pid ?? 1,
    rss: options.rss * MB,
    heapUsed: 10 * MB,
    heapTotal: 20 * MB,
    external: 5 * MB,
    arrayBuffers: MB,
    jscHeap: options.rss * MB * 0.5,
    ...(options.top !== undefined && { top: options.top, objects: options.objects ?? 0 }),
    costMs: 2,
  });
}

const LOG = [
  row({ t: 0, rss: 300, top: { string: 100, Object: 50 }, objects: 150 }),
  row({ t: 1000, rss: 310 }),
  row({ t: 2000, rss: 800, top: { string: 600, Object: 60, Promise: 5 }, objects: 665 }),
  row({ t: 3000, rss: 450, top: { string: 400, Object: 60 }, objects: 460 }),
  JSON.stringify({ t: 2500, pid: 1, snapshot: '/tmp/h.1.0.heapsnapshot', ms: 3000 }),
  row({ t: 500, pid: 2, rss: 80 }),
].join('\n');

describe('parseHeap splits one file into a series per process', () => {
  const log = parseHeap(LOG);

  test('each pid gets its own rows, in time order', () => {
    expect(log.series.get(1)?.map((entry) => entry.t)).toEqual([0, 1000, 2000, 3000]);
    expect(log.series.get(2)).toHaveLength(1);
  });

  test('the process with the most rows is the main one', () => {
    expect(mainPid(log)).toBe(1);
  });

  test('a snapshot line is kept apart from the rows', () => {
    expect(log.snapshots).toEqual([{ t: 2500, pid: 1, file: '/tmp/h.1.0.heapsnapshot', ms: 3000 }]);
  });

  test('a row without the type census has no top table', () => {
    expect(log.series.get(1)?.[1]?.top).toBeUndefined();
    expect(log.series.get(1)?.[0]?.top?.get('string')).toBe(100);
  });

  test('a failed snapshot is reported, not lost', () => {
    const failed = parseHeap(JSON.stringify({ t: 1, pid: 1, snapshotFailed: 'ENOSPC' }));
    expect(failed.failures).toEqual(['ENOSPC']);
  });

  test('junk and truncated lines are dropped', () => {
    const junk = parseHeap(['not json', '{"t":1', '{"pid":1}', ''].join('\n'));
    expect(junk.series.size).toBe(0);
  });
});

describe('summariseHeap names the baseline, the peak and the end', () => {
  const rows = parseHeap(LOG).series.get(1) ?? [];
  const summary = summariseHeap(rows, 1000);

  test('the baseline is the mean of the first seconds', () => {
    expect(summary?.rss.baseline).toBe(305 * MB);
  });

  test('the peak knows when it happened', () => {
    expect(summary?.rss.peak).toBe(800 * MB);
    expect(summary?.rss.peakT).toBe(2000);
  });

  test('the end is the last row', () => {
    expect(summary?.rss.end).toBe(450 * MB);
  });

  test('a metric that only some rows carry is read from those rows', () => {
    expect(summary?.objects?.peak).toBe(665);
    expect(summary?.objects?.end).toBe(460);
  });

  test('the sampler reports what it costs', () => {
    expect(summary?.costMeanMs).toBe(2);
  });

  test('no rows means no summary', () => {
    expect(summariseHeap([])).toBeUndefined();
  });

  test('the text says memory rose and settled', () => {
    expect(summary).toBeDefined();
    const text = formatHeapSummary(summary ?? fail(), 0);
    expect(text).toContain('rose 305.0 MB');
    expect(text).toContain('settled');
  });
});

describe('typeGrowth lists the types that grew between two moments', () => {
  const rows = parseHeap(LOG).series.get(1) ?? [];

  test('the biggest count delta comes first', () => {
    const growth = typeGrowth(rows, { fromMs: 0, toMs: 2000 });
    expect(growth.map((entry) => entry.type)).toEqual(['string', 'Object', 'Promise']);
    expect(growth[0]).toEqual({ type: 'string', from: 100, to: 600, delta: 500 });
  });

  test('a moment between two censuses uses the one before it', () => {
    const growth = typeGrowth(rows, { fromMs: 1500, toMs: 2500 });
    expect(growth[0]?.from).toBe(100);
    expect(growth[0]?.to).toBe(600);
  });

  test('a type that shrank is not listed', () => {
    expect(typeGrowth(rows, { fromMs: 2000, toMs: 3000 })).toEqual([]);
  });

  test('the limit caps the list', () => {
    expect(typeGrowth(rows, { fromMs: 0, toMs: 2000 }, 1)).toHaveLength(1);
  });

  test('rows without any census give no growth', () => {
    expect(typeGrowth([], { fromMs: 0, toMs: 1 })).toEqual([]);
  });

  test('the text names each type with its delta', () => {
    expect(formatTypeGrowth(typeGrowth(rows, { fromMs: 0, toMs: 2000 }))).toContain('string');
    expect(formatTypeGrowth([])).toContain('no object type grew');
  });
});

describe('the heap patch stays anchored', () => {
  const [sampler] = heapPatches;
  const names = [...(sampler?.replace.matchAll(/\blet (?<name>[A-Za-z_$][\w$]*)/gu) ?? [])].map(
    (match) => match.groups?.['name'] ?? '',
  );

  test('it anchors on a literal that appears once in the entry module', () => {
    expect(sampler?.find).toBe(HEAP_ANCHOR);
    expect(sampler?.replace.startsWith(HEAP_ANCHOR)).toBe(true);
  });

  test('it stays silent unless the file variable is set', () => {
    expect(sampler?.replace).toContain(`process.env.${HEAP_VARIABLE}`);
    expect(sampler?.replace).toContain('if(!$ODfile)return 0');
  });

  test('its timer never keeps the process alive', () => {
    expect(sampler?.replace).toContain('.unref()');
  });

  test('it reads the interval and the census cadence from the environment', () => {
    expect(sampler?.replace).toContain(`process.env.${HEAP_INTERVAL_VARIABLE}`);
    expect(sampler?.replace).toContain(`process.env.${HEAP_TYPES_VARIABLE}`);
  });

  test('it takes snapshots on a signal that the exit handlers in the app ignore', () => {
    expect(HEAP_SNAPSHOT_SIGNAL).toBe('SIGUSR1');
    expect(sampler?.replace).toContain(`process.on("${HEAP_SNAPSHOT_SIGNAL}"`);
  });

  test('every name it declares belongs to the payload', () => {
    expect(names.length).toBeGreaterThan(5);
    expect(names.every((name) => name.startsWith('$OD'))).toBe(true);
  });

  test('it does not use the free global Bun, which the rebase cannot resolve', () => {
    expect(sampler?.replace).not.toMatch(/(?<![.\w$])Bun\./u);
  });
});
