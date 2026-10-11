import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

import { hasErrorCode } from '../cli.ts';
import { COUNTER_VARIABLE } from '../patch/counter-patches.ts';
import type { CounterWindows, Span } from './counters.ts';
import { span, windowsOf } from './counters.ts';
import type { LaunchEnv } from './launch.ts';

const SAMPLE_GAP_MS = 200;
const FLUSH_MS = SAMPLE_GAP_MS + 100;
const COUNTER_FILE = 'counters.jsonl';

export interface Counted {
  counters: CounterWindows | undefined;
}

export interface Measured<T> {
  reading: T;
  spans: Record<string, Span>;
}

export interface Recorder<R extends object> {
  env: (dir: string) => LaunchEnv;
  read: (dir: string, spans: Record<string, Span>) => Promise<R>;
}

export async function endSpan(fromMonotonicMs: number): Promise<Span> {
  const toMonotonicMs = performance.now();
  await delay(FLUSH_MS);
  return span(fromMonotonicMs, toMonotonicMs);
}

async function readIfWritten(file: string): Promise<string> {
  try {
    return await Bun.file(file).text();
  } catch (error) {
    if (hasErrorCode(error, 'ENOENT')) {
      return '';
    }
    throw error;
  }
}

export function fileRecorder<R extends object>(
  variable: string,
  file: string,
  read: (text: string, spans: Record<string, Span>) => R,
): Recorder<R> {
  return {
    env: (dir) => ({ [variable]: path.join(dir, file) }),
    read: async (dir, spans) => read(await readIfWritten(path.join(dir, file)), spans),
  };
}

export const counterRecorder: Recorder<Counted> = fileRecorder(
  COUNTER_VARIABLE,
  COUNTER_FILE,
  (text, spans) => ({ counters: windowsOf(text, spans) }),
);

export async function withRecorder<T extends object, R extends object>(
  recorder: Recorder<R>,
  measure: (env: LaunchEnv) => Promise<Measured<T>>,
): Promise<T & R> {
  const dir = mkdtempSync(path.join(tmpdir(), 'ovrdroid-record-'));
  try {
    const { reading, spans } = await measure(recorder.env(dir));
    return { ...reading, ...(await recorder.read(dir, spans)) };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
