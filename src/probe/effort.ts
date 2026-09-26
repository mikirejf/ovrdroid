import type { Frame, Session } from './session.ts';
import { ENTER, openClearMenu, openSession, openSettledSession } from './session.ts';

const CYCLE_EFFORT = '\t';
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

const STATUS_MARK = '·';
const TRAILING_EFFORT = /\((?<effort>[^()]+)\)\s*$/u;
export const DEFAULT_CLEARS = 3;

export type ShownEffort = string | null;

export interface KeptReading {
  startup: ShownEffort;
  afterClears: ShownEffort[];
}

export function shownEffort(text: string): ShownEffort | undefined {
  const line = text.split('\n').findLast((candidate) => candidate.includes(STATUS_MARK));
  if (line === undefined) {
    return undefined;
  }
  return TRAILING_EFFORT.exec(line)?.groups?.['effort'] ?? null;
}

export function lastShownEffort(frames: readonly Frame[]): ShownEffort | undefined {
  return frames.map((frame) => shownEffort(frame.text)).findLast((found) => found !== undefined);
}

export function effortKept(reading: KeptReading): boolean {
  return (
    reading.startup !== null && reading.afterClears.every((effort) => effort === reading.startup)
  );
}

function shown(effort: ShownEffort): string {
  return effort === null ? 'no effort shown' : `"${effort}"`;
}

function verdictOf(effort: ShownEffort, startup: ShownEffort): string {
  if (effort === startup) {
    return '';
  }
  return effort === null
    ? ': the new session dropped the effort'
    : ': the new session changed the effort';
}

export function describeKept(reading: KeptReading): string {
  const lines = [`at startup: ${shown(reading.startup)}`];
  for (const [index, effort] of reading.afterClears.entries()) {
    lines.push(`after /clear ${index + 1}: ${shown(effort)}${verdictOf(effort, reading.startup)}`);
  }
  return lines.join('\n');
}

async function settledEffort(session: Session): Promise<ShownEffort> {
  const deadline = performance.now() + TIMEOUT_MS;
  while (lastShownEffort(session.frames()) === undefined) {
    if (performance.now() > deadline) {
      throw new Error(`no status line on screen after ${TIMEOUT_MS}ms`);
    }
    // oxlint-disable-next-line no-await-in-loop
    await Bun.sleep(POLL_MS);
  }
  await session.quiet(QUIET_MS, TIMEOUT_MS);
  const effort = lastShownEffort(session.frames());
  if (effort === undefined) {
    throw new Error('the status line vanished while the screen settled');
  }
  return effort;
}

export async function effortAcrossClears(binary: string, clears: number): Promise<KeptReading> {
  const session = await openSession(binary);
  try {
    const startup = await settledEffort(session);
    const afterClears: ShownEffort[] = [];
    for (let clear = 0; clear < clears; clear += 1) {
      // oxlint-disable-next-line no-await-in-loop
      await openClearMenu(session);
      session.mark();
      // oxlint-disable-next-line no-await-in-loop
      await session.type(ENTER);
      // oxlint-disable-next-line no-await-in-loop
      afterClears.push(await settledEffort(session));
    }
    return { startup, afterClears };
  } finally {
    await session.close();
  }
}

export async function cycleEffortAfterClear(binary: string): Promise<EffortReading> {
  const { session } = await openSettledSession(binary);
  try {
    await openClearMenu(session);
    return await cycleAndRead(session, await labelOnScreen(session), ENTER + CYCLE_EFFORT);
  } finally {
    await session.close();
  }
}
