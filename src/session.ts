import { setTimeout as delay } from 'node:timers/promises';

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
const KEY_GAP_MS = 60;
const QUIET_POLL_MS = 50;
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
}

export interface Session {
  type: (text: string) => Promise<void>;
  quiet: (quietMs: number, timeoutMs: number) => Promise<void>;
  mark: () => undefined;
  frames: () => readonly Frame[];
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

  const terminal = new Bun.Terminal({
    ...TERMINAL_SIZE,
    data(self, chunk) {
      const text = decoder.decode(chunk, { stream: true });
      answerProbes(self, text);
      if (text.includes(PAINT_MARKER)) {
        painted.resolve(true);
      }
      lastOutputAt = performance.now();
      const cut = cutFrames(pending + text);
      pending = cut.rest;
      const atMs = lastOutputAt - markedAt;
      collected.push(...cut.frames.map((frame) => ({ atMs, text: plain(frame) })));
    },
  });

  const child = Bun.spawn([binary], { terminal, env: launchEnv(options.env) });

  const close = async (): Promise<void> => {
    child.kill('SIGKILL');
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
      markedAt = performance.now();
    },
    frames: () => collected,
    close,
  };
}
