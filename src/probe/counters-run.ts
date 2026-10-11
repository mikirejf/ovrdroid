import { setTimeout as delay } from 'node:timers/promises';

import type { RunOptions } from '../cli.ts';
import { messageOf, say } from '../cli.ts';
import { interleave } from './ab.ts';
import type { Counted, Measured } from './counter-file.ts';
import { endSpan, withCounters } from './counter-file.ts';
import { sayCounters } from './counters-report.ts';
import type { Span } from './counters.ts';
import type { Session } from './session.ts';
import { openSettledSession } from './session.ts';

export const DEFAULT_KEYS = 40;
const IDLE_MS = 2000;
const TRAILING_MS = 400;
const CLEAR_INPUT_LINE = '\u0015';
const MENU_TEXT = '/sessio';
const LETTERS = 'abcdefghijklmnopqrstuvwxyz';

export interface CountersOptions extends RunOptions {
  keys: number;
}

function keysOf(length: number): string {
  return LETTERS.repeat(Math.ceil(length / LETTERS.length)).slice(0, length);
}

async function typed(session: Session, text: string): Promise<Span> {
  const from = performance.now();
  await session.type(text);
  await delay(TRAILING_MS);
  return await endSpan(from);
}

async function measureWindows(session: Session, keys: number): Promise<Measured<object>> {
  const idleFrom = performance.now();
  await delay(IDLE_MS);
  const idle = await endSpan(idleFrom);
  const typing = await typed(session, keysOf(keys));
  await session.type(CLEAR_INPUT_LINE);
  await delay(TRAILING_MS);
  const menu = await typed(session, MENU_TEXT);
  return { reading: {}, spans: { idle, typing, menu } };
}

async function measureCounters(binary: string, keys: number): Promise<Counted> {
  const run = await withCounters(async (env) => {
    const { session } = await openSettledSession(binary, { env });
    try {
      return await measureWindows(session, keys);
    } finally {
      await session.close();
    }
  });
  if (run.counters === undefined) {
    throw new Error('wrote no counter samples: build it with probe build --counters');
  }
  return run;
}

export async function counters(binaries: string[], options: CountersOptions): Promise<void> {
  say(
    `each run opens a session and measures three windows: ${IDLE_MS}ms idle, ${options.keys} typed keys, and the slash menu opened by typing "${MENU_TEXT}"`,
  );
  say(`each window ends ${TRAILING_MS}ms after its last key, so late renders count`);

  const results = await interleave(
    binaries,
    async (binary) =>
      await measureCounters(binary, options.keys).catch((error: unknown) => {
        throw new Error(`${binary}: ${messageOf(error)}`);
      }),
    options.runs,
  );

  sayCounters(results);
}
