import { setTimeout as delay } from 'node:timers/promises';

import { MS_PER_SECOND, say } from '../cli.ts';
import type { LaunchEnv } from './launch.ts';
import {
  dies,
  launchEnv,
  PAINT_MARKER,
  PAINT_TIMEOUT_MS,
  probeAnswerer,
  race,
  TERMINAL_SIZE,
} from './launch.ts';

const FRAME_END = '\u001B[?2026l';
const PASTE_START = '\u001B[200~';
const PASTE_END = '\u001B[201~';
const KEY_GAP_MS = 60;
const QUIET_POLL_MS = 50;
const REPLY_POLL_MS = 100;
export const ENTER = '\r';
export const INPUT_PREFIX = '│ > ';
const CLEAR_COMMAND = '/clear';
const MENU_SETTLE_MS = 300;
// oxlint-disable-next-line no-control-regex
const ANSI = /\u001B\[[0-9;:?]*[A-Za-z]/gu;
// oxlint-disable-next-line no-control-regex
const OSC = /\u001B\][^\u0007]*\u0007/gu;

export interface Frame {
  atMs: number;
  text: string;
}

interface Cut {
  frames: readonly string[];
  rest: string;
}

export interface SessionOptions {
  env?: LaunchEnv;
  signal?: NodeJS.Signals;
  collect?: boolean;
  cwd?: string;
}

export const SETTLE_MS = 3000;
export const SETTLE_TIMEOUT_MS = 15_000;

export interface Session {
  pid: number;
  startedAt: number;
  type: (text: string) => Promise<void>;
  paste: (text: string) => undefined;
  quiet: (quietMs: number, timeoutMs: number) => Promise<void>;
  mark: () => undefined;
  frames: () => readonly Frame[];
  bytes: () => number;
  close: () => Promise<void>;
}

export function plain(text: string): string {
  return text.replaceAll(ANSI, '').replaceAll(OSC, '');
}

export function cutFrames(buffer: string): Cut {
  const frames: string[] = [];
  let rest = buffer;
  let end = rest.indexOf(FRAME_END);

  while (end !== -1) {
    frames.push(rest.slice(0, end));
    rest = rest.slice(end + FRAME_END.length);
    end = rest.indexOf(FRAME_END);
  }

  return { frames, rest };
}

export async function openSession(binary: string, options: SessionOptions = {}): Promise<Session> {
  const decoder = new TextDecoder();
  const answerProbes = probeAnswerer();
  const painted = Promise.withResolvers<boolean>();

  let pending = '';
  let markedAt = performance.now();
  let lastOutputAt = performance.now();
  let collected: Frame[] = [];
  let written = 0;

  const terminal = new Bun.Terminal({
    ...TERMINAL_SIZE,
    data(self, chunk) {
      const text = decoder.decode(chunk, { stream: true });
      answerProbes(self, text);
      if (text.includes(PAINT_MARKER)) {
        painted.resolve(true);
      }
      written += chunk.byteLength;
      lastOutputAt = performance.now();
      if (options.collect === false) {
        return;
      }
      const cut = cutFrames(pending + text);
      pending = cut.rest;
      const atMs = lastOutputAt - markedAt;
      for (const frame of cut.frames) {
        collected.push({ atMs, text: plain(frame) });
      }
    },
  });

  const startedAt = performance.now();
  const child = Bun.spawn([binary], {
    terminal,
    env: launchEnv(options.env),
    ...(options.cwd !== undefined && { cwd: options.cwd }),
  });

  let closed = false;
  const close = async (): Promise<void> => {
    if (closed) {
      return;
    }
    closed = true;
    child.kill(options.signal ?? 'SIGKILL');
    await child.exited;
    await terminal[Symbol.asyncDispose]();
  };

  try {
    await race(
      Promise.race([painted.promise, dies(child)]),
      PAINT_TIMEOUT_MS,
      `${binary}: no input box after ${PAINT_TIMEOUT_MS}ms`,
    );
  } catch (error) {
    await close();
    throw error;
  }

  return {
    async type(text: string): Promise<void> {
      for (const key of text) {
        terminal.write(key);
        // oxlint-disable-next-line no-await-in-loop
        await delay(KEY_GAP_MS);
      }
    },
    paste(text: string): undefined {
      terminal.write(PASTE_START + text + PASTE_END);
    },
    async quiet(quietMs: number, timeoutMs: number): Promise<void> {
      const deadline = performance.now() + timeoutMs;
      while (performance.now() - lastOutputAt < quietMs && performance.now() < deadline) {
        // oxlint-disable-next-line no-await-in-loop
        await delay(QUIET_POLL_MS);
      }
    },
    mark(): undefined {
      collected = [];
      pending = '';
      written = 0;
      markedAt = performance.now();
    },
    frames: () => collected,
    bytes: () => written,
    pid: child.pid,
    startedAt,
    close,
  };
}

export interface SettledSession {
  session: Session;
  settledAt: number;
}

export async function openSettledSession(
  binary: string,
  options: SessionOptions = {},
): Promise<SettledSession> {
  const session = await openSession(binary, options);
  try {
    await session.quiet(SETTLE_MS, SETTLE_TIMEOUT_MS);
  } catch (error) {
    await session.close();
    throw error;
  }
  const settledAt = performance.now();
  session.mark();
  return { session, settledAt };
}

export function msOrNever(value: number | undefined): string {
  return value === undefined ? 'never' : `${Math.round(value)}ms`;
}

export async function openClearMenu(session: Session): Promise<void> {
  await session.type(CLEAR_COMMAND);
  await delay(MENU_SETTLE_MS);
}

export interface ReplyOptions<T> {
  text: string;
  read: (frames: readonly Frame[]) => T;
  done: (reading: T) => boolean;
  timeoutMs: number;
  quietMs: number;
  paste?: boolean;
}

export async function sendAndRead<T>(session: Session, options: ReplyOptions<T>): Promise<T> {
  try {
    if (options.paste === true) {
      session.paste(options.text);
    } else {
      await session.type(options.text);
    }
    session.mark();
    await session.type(ENTER);

    const deadline = performance.now() + options.timeoutMs;
    while (!options.done(options.read(session.frames())) && performance.now() < deadline) {
      // oxlint-disable-next-line no-await-in-loop
      await delay(REPLY_POLL_MS);
    }
    await session.quiet(options.quietMs, options.timeoutMs);
    return options.read(session.frames());
  } finally {
    await session.close();
  }
}

export async function standBy(windowSeconds: number): Promise<void> {
  say(`standing by for ${windowSeconds}s`);
  await delay(windowSeconds * MS_PER_SECOND);
}
