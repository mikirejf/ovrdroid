import type { Frame, Session } from './session.ts';
import { openSession, openSettledSession } from './session.ts';

const CYCLE_EFFORT = '\t';
const CLEAR = '/clear';
const ENTER = '\r';
const MENU_SETTLE_MS = 300;
const POLL_MS = 50;
const LABEL_TIMEOUT_MS = 15_000;
const QUIET_MS = 3000;
const TIMEOUT_MS = 30_000;
export const LAG_LIMIT_MS = 1000;
const STATUS_LABEL = /·.*\((?<effort>[^()]+)\)\s*$/mu;

export interface EffortReading {
  before: string;
  changedMs: number | undefined;
  final: string | undefined;
}

export function labelOf(text: string): string | undefined {
  return STATUS_LABEL.exec(text)?.groups?.['effort'];
}

export function readEffort(before: string, frames: readonly Frame[]): EffortReading {
  const labelled = frames.flatMap((frame) => {
    const label = labelOf(frame.text);
    return label === undefined ? [] : [{ atMs: frame.atMs, label }];
  });
  return {
    before,
    changedMs: labelled.find((entry) => entry.label !== before)?.atMs,
    final: labelled.at(-1)?.label,
  };
}

export function effortHeld(reading: EffortReading): boolean {
  return (
    reading.changedMs !== undefined &&
    reading.changedMs <= LAG_LIMIT_MS &&
    reading.final !== undefined &&
    reading.final !== reading.before
  );
}

export function describeEffort(reading: EffortReading): string {
  const pressed = `effort was "${reading.before}" when the key was pressed`;
  if (reading.changedMs === undefined) {
    return `${pressed}\nthe label never moved: the key press was ignored`;
  }
  const ms = Math.round(reading.changedMs);
  return [
    pressed,
    ms <= LAG_LIMIT_MS
      ? `the label moved ${ms}ms after the key press`
      : `the label moved only ${ms}ms after the key press, over the ${LAG_LIMIT_MS}ms a key press should take`,
    reading.final === reading.before
      ? `then fell back to "${reading.before}": the change was lost`
      : `and stayed at "${reading.final ?? ''}"`,
  ].join('\n');
}

async function labelOnScreen(session: Session): Promise<string> {
  const deadline = performance.now() + LABEL_TIMEOUT_MS;
  while (performance.now() < deadline) {
    const label = session
      .frames()
      .map((frame) => labelOf(frame.text))
      .findLast((found) => found !== undefined);
    if (label !== undefined) {
      return label;
    }
    // oxlint-disable-next-line no-await-in-loop
    await Bun.sleep(POLL_MS);
  }
  throw new Error(`no effort label on screen after ${LABEL_TIMEOUT_MS}ms`);
}

async function cycleAndRead(
  session: Session,
  before: string,
  keys: string,
): Promise<EffortReading> {
  session.mark();
  await session.type(keys);
  await session.quiet(QUIET_MS, TIMEOUT_MS);
  return readEffort(before, session.frames());
}

export async function cycleEffortAtStartup(binary: string): Promise<EffortReading> {
  const session = await openSession(binary);
  try {
    return await cycleAndRead(session, await labelOnScreen(session), CYCLE_EFFORT);
  } finally {
    await session.close();
  }
}

export async function cycleEffortAfterClear(binary: string): Promise<EffortReading> {
  const { session } = await openSettledSession(binary);
  try {
    await session.type(CLEAR);
    await Bun.sleep(MENU_SETTLE_MS);
    return await cycleAndRead(session, await labelOnScreen(session), ENTER + CYCLE_EFFORT);
  } finally {
    await session.close();
  }
}
