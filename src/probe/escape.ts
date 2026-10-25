import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

import { say } from '../cli.ts';
import type { EscapeVerdict, RewindVerdict } from './escape-report.ts';
import {
  CANCELLED_TEXT,
  describeEscape,
  describeRewind,
  escapeVerdict,
  readEscape,
  REPLY_OPENING,
  REWIND_MENU,
  rewindVerdict,
} from './escape-report.ts';
import { poll } from './poll.ts';
import { ENTER, openSettledSession } from './session.ts';
import type { Session } from './session.ts';
import type { ReplyPlan } from './stub-model.ts';
import { pieces, replyText, startStubModel, STUB_END, stubSettings } from './stub-model.ts';

const PLAN: ReplyPlan = { chars: 100, chunk: 40, gapMs: 600 };
const PROMPT = 'Explain the pipeline.';
const ESCAPE = '\u001B';
const PASTE_QUIET_MS = 300;
const PASTE_TIMEOUT_MS = 3000;
const START_TIMEOUT_MS = 20_000;
const DOUBLE_PRESS_GAP_MS = 1000;
const TRIPLE_PRESS_GAP_MS = 120;
const MENU_TIMEOUT_MS = 3000;
const FINISH_MARGIN_MS = 15_000;
const QUIET_MS = 1500;
const QUIET_TIMEOUT_MS = 10_000;

function screens(session: Session): string[] {
  return session.frames().map((frame) => frame.text);
}

function showsAny(session: Session, needles: readonly string[]): true | undefined {
  const all = screens(session);
  return needles.some((needle) => all.some((screen) => screen.includes(needle))) ? true : undefined;
}

async function pressEscapeTwice(session: Session): Promise<void> {
  session.press(ESCAPE);
  await delay(DOUBLE_PRESS_GAP_MS);
  session.press(ESCAPE);
}

async function startTurn(session: Session): Promise<boolean> {
  session.paste(PROMPT);
  await session.quiet(PASTE_QUIET_MS, PASTE_TIMEOUT_MS);
  session.mark();
  await session.type(ENTER);
  return (await poll(() => showsAny(session, [REPLY_OPENING]), START_TIMEOUT_MS)) !== undefined;
}

async function driveTurn(session: Session): Promise<string[]> {
  if (!(await startTurn(session))) {
    return screens(session);
  }
  await pressEscapeTwice(session);
  const streamMs = pieces(replyText(PLAN.chars), PLAN.chunk).length * PLAN.gapMs;
  await poll(() => showsAny(session, [STUB_END, CANCELLED_TEXT]), streamMs + FINISH_MARGIN_MS);
  await session.quiet(QUIET_MS, QUIET_TIMEOUT_MS);
  return screens(session);
}

async function driveRewind(session: Session): Promise<string[]> {
  if (!(await startTurn(session))) {
    return screens(session);
  }
  session.press(ESCAPE);
  await delay(TRIPLE_PRESS_GAP_MS);
  session.press(ESCAPE);
  await delay(TRIPLE_PRESS_GAP_MS);
  session.press(ESCAPE);
  await delay(TRIPLE_PRESS_GAP_MS);
  await poll(() => showsAny(session, [REWIND_MENU]), MENU_TIMEOUT_MS);
  return screens(session);
}

async function inFreshSession<T>(
  binary: string,
  drive: (session: Session) => Promise<string[]>,
  read: (screens: string[]) => T,
): Promise<T> {
  const stub = startStubModel(PLAN);
  const dir = mkdtempSync(path.join(tmpdir(), 'ovrdroid-escape-'));
  const file = path.join(dir, 'settings.json');
  writeFileSync(file, JSON.stringify(stubSettings(stub.url)));
  try {
    const { session } = await openSettledSession(binary, {
      env: { FACTORY_RUNTIME_SETTINGS_PATH: file },
    });
    try {
      return read(await drive(session));
    } finally {
      await session.close();
    }
  } finally {
    await stub.stop();
    rmSync(dir, { recursive: true, force: true });
  }
}

export async function escapeDuringTurn(binary: string): Promise<EscapeVerdict> {
  return await inFreshSession(binary, driveTurn, (all) => escapeVerdict(readEscape(all)));
}

export async function rewindDuringTurn(binary: string): Promise<RewindVerdict> {
  return await inFreshSession(binary, driveRewind, rewindVerdict);
}

export async function escape(binary: string): Promise<void> {
  say(
    `a stub model streams a reply for about ${(pieces(replyText(PLAN.chars), PLAN.chunk).length * PLAN.gapMs) / 1000}s; Esc is pressed twice, ${DOUBLE_PRESS_GAP_MS}ms apart, once the reply starts showing`,
  );
  const verdict = await escapeDuringTurn(binary);
  say(describeEscape(verdict));
  say(
    `a second turn: Esc is pressed 3 times, ${TRIPLE_PRESS_GAP_MS}ms apart; the rewind menu should open`,
  );
  const rewind = await rewindDuringTurn(binary);
  say(describeRewind(rewind));
  if (!verdict.pass || !rewind.pass) {
    process.exitCode = 1;
  }
}
