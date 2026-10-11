import { existsSync, readFileSync } from 'node:fs';
import { setTimeout as delay } from 'node:timers/promises';

import { MS_PER_SECOND, say } from '../cli.ts';
import { HEAP_SNAPSHOT_SIGNAL } from '../patch/heap-patches.ts';
import { parseHeap } from './heap.ts';
import type { Sampler } from './sample-report.ts';
import type { Span } from './series.ts';
import { median } from './series.ts';
import { hasSettled, rssSeries } from './subagents.ts';

export const POLL_MS = 250;
const SETTLE_CAP_MS = 120_000;
const SNAPSHOT_TIMEOUT_MS = 120_000;

function snapshotsOf(heapFile: string, pid: number): number {
  const log = parseHeap(readFileSync(heapFile, 'utf-8'));
  if (log.failures.length > 0) {
    throw new Error(`heap snapshot failed: ${log.failures.join('; ')}`);
  }
  return log.snapshots.filter((snapshot) => snapshot.pid === pid).length;
}

export async function takeSnapshot(pid: number, heapFile: string, label: string): Promise<Span> {
  if (!existsSync(heapFile)) {
    throw new Error(`${heapFile} does not exist: was the binary built with --heap?`);
  }
  const had = snapshotsOf(heapFile, pid);
  const fromMs = Date.now();
  say(`taking the ${label} heap snapshot (this stops Droid for a few seconds)`);
  process.kill(pid, HEAP_SNAPSHOT_SIGNAL);

  const deadline = performance.now() + SNAPSHOT_TIMEOUT_MS;
  while (snapshotsOf(heapFile, pid) === had) {
    if (performance.now() > deadline) {
      throw new Error(`no ${label} heap snapshot after ${SNAPSHOT_TIMEOUT_MS / MS_PER_SECOND}s`);
    }
    // oxlint-disable-next-line no-await-in-loop
    await delay(POLL_MS);
  }
  return { fromMs, toMs: Date.now() };
}

export async function settleAfterSnapshot(
  sampler: Sampler,
  snapshot: Span,
): Promise<{ span: Span; settled: boolean }> {
  const before = rssSeries(sampler.ticks())
    .filter((point) => point.t < snapshot.fromMs)
    .map((point) => point.value);
  const target = median(before) ?? 0;
  const deadline = performance.now() + SETTLE_CAP_MS;
  let settled = false;
  while (!settled && performance.now() < deadline) {
    // oxlint-disable-next-line no-await-in-loop
    await delay(POLL_MS);
    settled = hasSettled(
      rssSeries(sampler.ticks())
        .filter((point) => point.t > snapshot.toMs)
        .map((point) => point.value),
      target,
    );
  }
  say(
    settled
      ? 'memory is back near the pre-snapshot level'
      : `memory did not return near the pre-snapshot level within ${SETTLE_CAP_MS / MS_PER_SECOND}s: the baseline and later figures include snapshot residue`,
  );
  return { span: { fromMs: snapshot.fromMs, toMs: Date.now() }, settled };
}
