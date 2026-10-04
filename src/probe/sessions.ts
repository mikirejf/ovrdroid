import { setTimeout as delay } from 'node:timers/promises';

import { quantile } from './ab.ts';
import type { Frame, Session } from './session.ts';
import { ENTER, msOrNever, openSession } from './session.ts';

const COMMAND = '/sessions';
const ESCAPE = '\u001B';
const LIST_HEADER = /Modified\s+Created/u;
const RANGE = /\d+-\d+ of (?<total>\d+)/u;
const MENU_SETTLE_MS = 300;
const CLOSE_SETTLE_MS = 800;
const POLL_MS = 5;
const LIST_TIMEOUT_MS = 20_000;
const MEDIAN = 0.5;
export const DEFAULT_RUNS = 5;
export const DEFAULT_OPENS = 2;
export const DEFAULT_WAIT_MS = 0;

export interface SessionsReading {
  shownMs: number | undefined;
  total: number | undefined;
}

export interface SessionsOptions {
  opens: number;
  waitMs: number;
  cwd: string;
}

export function readSessionsList(frames: readonly Frame[]): SessionsReading {
  const shown = frames.find((frame) => LIST_HEADER.test(frame.text));
  const latest = frames.findLast((frame) => LIST_HEADER.test(frame.text));
  const total = latest === undefined ? undefined : RANGE.exec(latest.text)?.groups?.['total'];
  return {
    shownMs: shown?.atMs,
    total: total === undefined ? undefined : Number(total),
  };
}

function ordinal(open: number): string {
  return open === 0 ? 'first open' : `open ${open + 1}`;
}

export function describeSessions(runs: readonly (readonly SessionsReading[])[]): string {
  const opens = Math.max(0, ...runs.map((run) => run.length));
  const lines = runs.map(
    (run, index) =>
      `run ${index + 1}: ${run.map((reading) => msOrNever(reading.shownMs)).join(', ')}`,
  );
  for (let open = 0; open < opens; open += 1) {
    const shown = runs.map((run) => run[open]?.shownMs);
    const times = shown.filter((ms) => ms !== undefined);
    const missed = shown.length - times.length;
    const median = times.length === 0 ? 'never' : msOrNever(quantile(times, MEDIAN));
    const misses = missed === 0 ? '' : `, and never showed in ${missed} of ${shown.length} runs`;
    lines.push(`${ordinal(open)}: the list showed a median ${median} after Enter${misses}`);
  }
  const total = runs.flat().find((reading) => reading.total !== undefined)?.total;
  if (total !== undefined) {
    lines.push(`the first tab listed ${total} sessions`);
  }
  return lines.join('\n');
}

async function openList(session: Session): Promise<SessionsReading> {
  await session.type(COMMAND);
  await delay(MENU_SETTLE_MS);
  session.mark();
  await session.type(ENTER);
  const deadline = performance.now() + LIST_TIMEOUT_MS;
  let reading = readSessionsList(session.frames());
  while (reading.shownMs === undefined && performance.now() < deadline) {
    // oxlint-disable-next-line no-await-in-loop
    await delay(POLL_MS);
    reading = readSessionsList(session.frames());
  }
  await session.type(ESCAPE);
  await delay(CLOSE_SETTLE_MS);
  return reading;
}

export async function timeSessionsList(
  binary: string,
  options: SessionsOptions,
): Promise<SessionsReading[]> {
  const session = await openSession(binary, { cwd: options.cwd });
  try {
    await delay(options.waitMs);
    const readings: SessionsReading[] = [];
    for (let open = 0; open < options.opens; open += 1) {
      // oxlint-disable-next-line no-await-in-loop
      readings.push(await openList(session));
    }
    return readings;
  } finally {
    await session.close();
  }
}
