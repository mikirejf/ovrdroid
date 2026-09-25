import type { Frame } from './session.ts';
import { ENTER, INPUT_PREFIX, msOrNever, openClearMenu, openSettledSession } from './session.ts';

export const TYPED_AFTER_CLEAR = 'typed while the new session starts';
const BUSY_TEXT = 'Starting new session';
const READY_TEXT = 'New session created';
const BOX_EDGE = '│';
const QUIET_MS = 2500;
const TIMEOUT_MS = 30_000;

export interface ClearReading {
  busyMs: number | undefined;
  readyMs: number | undefined;
  input: string | undefined;
  kept: boolean;
}

function inputOf(frame: Frame): string | undefined {
  const line = frame.text.split('\n').find((row) => row.includes(INPUT_PREFIX));
  if (line === undefined) {
    return undefined;
  }
  const text = line.slice(line.indexOf(INPUT_PREFIX) + INPUT_PREFIX.length).trimEnd();
  return (text.endsWith(BOX_EDGE) ? text.slice(0, -BOX_EDGE.length) : text).trimEnd();
}

export function readClear(frames: readonly Frame[], typed: string): ClearReading {
  const busy = frames.findLast((frame) => frame.text.includes(BUSY_TEXT));
  const ready = frames.find((frame) => frame.text.includes(READY_TEXT));
  const input = frames.map((frame) => inputOf(frame)).findLast((text) => text !== undefined);
  return {
    busyMs: busy?.atMs,
    readyMs: ready?.atMs,
    input,
    kept: input === typed,
  };
}

export function describeClear(reading: ClearReading): string {
  return [
    `"New session created" showed after ${msOrNever(reading.readyMs)}`,
    reading.busyMs === undefined
      ? 'the "Starting new session" spinner never showed'
      : `the "Starting new session" spinner was last seen at ${msOrNever(reading.busyMs)}`,
    reading.kept
      ? 'text typed during the switch was kept in the input box'
      : `text typed during the switch was lost: the input box ended as "${reading.input ?? ''}"`,
  ].join('\n');
}

export async function clearWhileTyping(binary: string): Promise<ClearReading> {
  const { session } = await openSettledSession(binary);
  try {
    await openClearMenu(session);
    session.mark();
    await session.type(ENTER);
    await session.type(TYPED_AFTER_CLEAR);
    await session.quiet(QUIET_MS, TIMEOUT_MS);
    return readClear(session.frames(), TYPED_AFTER_CLEAR);
  } finally {
    await session.close();
  }
}
