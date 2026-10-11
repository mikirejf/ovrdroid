import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

import type { CounterWindows, Span } from './counters.ts';
import { span, windowsOf } from './counters.ts';
import type { LaunchEnv } from './launch.ts';

const SAMPLE_GAP_MS = 200;
const FLUSH_MS = SAMPLE_GAP_MS + 100;

export interface Counted {
  counters: CounterWindows | undefined;
}

export interface Measured<T> {
  reading: T;
  spans: Record<string, Span>;
}

export async function endSpan(fromMonotonicMs: number): Promise<Span> {
  const toMonotonicMs = performance.now();
  await delay(FLUSH_MS);
  return span(fromMonotonicMs, toMonotonicMs);
}

export async function withCounters<T extends object>(
  measure: (env: LaunchEnv) => Promise<Measured<T>>,
): Promise<T & Counted> {
  const dir = mkdtempSync(path.join(tmpdir(), 'ovrdroid-counters-'));
  const file = path.join(dir, 'counters.jsonl');
  try {
    const { reading, spans } = await measure({ OD_COUNTERS: file });
    const written = Bun.file(file);
    const text = (await written.exists()) ? await written.text() : '';
    return { ...reading, counters: windowsOf(text, spans) };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
