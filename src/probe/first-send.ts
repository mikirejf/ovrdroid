import { MS_PER_SECOND } from '../cli.ts';
import type { Frame, Session } from './session.ts';
import {
  ENTER,
  INPUT_PREFIX,
  msOrNever,
  openClearMenu,
  openSession,
  openSettledSession,
  sendAndRead,
} from './session.ts';

export const FIRST_SEND_PROMPT = 'Reply with the single word ok. Do not use tools.';
const SPINNER_TEXT = '(Press ESC to stop)';
const QUEUED_TEXT = 'queued';
const REPLY_LINE = /^[^\p{L}\p{N}]*ok[^\p{L}\p{N}]*$/iu;
const REPLY_TIMEOUT_MS = 60_000;
const QUIET_MS = 1500;

export interface FirstSendReading {
  echoMs: number | undefined;
  spinnerMs: number | undefined;
  replyMs: number | undefined;
  queued: boolean;
}

function linesOf(frame: Frame): string[] {
  return frame.text.split('\n').filter((line) => !line.includes(INPUT_PREFIX));
}

function firstAt(frames: readonly Frame[], matches: (line: string) => boolean): number | undefined {
  return frames.find((frame) => linesOf(frame).some((line) => matches(line)))?.atMs;
}

export function readFirstSend(frames: readonly Frame[], text: string): FirstSendReading {
  return {
    echoMs: firstAt(frames, (line) => line.includes(text)),
    spinnerMs: firstAt(frames, (line) => line.includes(SPINNER_TEXT)),
    replyMs: firstAt(frames, (line) => REPLY_LINE.test(line.trim())),
    queued: frames.some((frame) =>
      linesOf(frame).some((line) => line.toLowerCase().includes(QUEUED_TEXT)),
    ),
  };
}

export function describeFirstSend(reading: FirstSendReading): string {
  return [
    `the message showed in the transcript ${msOrNever(reading.echoMs)} after Enter`,
    `the working spinner showed ${msOrNever(reading.spinnerMs)} after Enter`,
    reading.replyMs === undefined
      ? `no reply within ${REPLY_TIMEOUT_MS / MS_PER_SECOND}s: the turn did not run`
      : `the reply arrived ${msOrNever(reading.replyMs)} after Enter, so the turn ran`,
    reading.queued
      ? 'the word "queued" showed: the message waited behind a busy session'
      : 'nothing said the message was queued',
  ].join('\n');
}

export interface FirstSendOptions {
  cwd: string;
  text: string;
  atPaint: boolean;
  afterClear: boolean;
}

async function openForSend(options: FirstSendOptions, binary: string): Promise<Session> {
  if (options.atPaint) {
    return await openSession(binary, { cwd: options.cwd });
  }
  const { session } = await openSettledSession(binary, { cwd: options.cwd });
  return session;
}

export async function sendFirstMessage(
  binary: string,
  options: FirstSendOptions,
): Promise<FirstSendReading> {
  const session = await openForSend(options, binary);
  if (options.afterClear) {
    try {
      await openClearMenu(session);
      await session.type(ENTER);
    } catch (error) {
      await session.close();
      throw error;
    }
  }
  return await sendAndRead(session, {
    text: options.text,
    paste: true,
    read: (frames) => readFirstSend(frames, options.text),
    done: (reading) => reading.replyMs !== undefined,
    timeoutMs: REPLY_TIMEOUT_MS,
    quietMs: QUIET_MS,
  });
}
