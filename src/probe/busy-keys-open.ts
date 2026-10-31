import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { cacheDir } from '../paths.ts';
import type { Chunk } from './busy-keys-read.ts';
import { keepToolCallForTurn } from './busy-keys-stub.ts';
import { poll } from './poll.ts';
import { asksForTrust } from './resume-report.ts';
import type { Placed } from './resume.ts';
import { place, QUIET_MS, remove } from './resume.ts';
import type { Session, SessionOptions } from './session.ts';
import { openSession, openSettledSession, SETTLE_MS, SETTLE_TIMEOUT_MS } from './session.ts';
import type { ReplyPlan, StubModel, ToolCall } from './stub-model.ts';
import { startStubModel, stubSettings } from './stub-model.ts';

export interface Rig {
  session: Session;
  stub: StubModel;
  chunks: Chunk[];
}

export interface Setup<T> {
  binary: string;
  plan: ReplyPlan;
  turns: number;
  firstCall?: ToolCall;
  drive: (rig: Rig) => Promise<T>;
}

const LAND_TIMEOUT_MS = 30_000;
const CWD_ROOT = cacheDir('busy-keys');

async function openFresh(binary: string, options: SessionOptions): Promise<Session> {
  const { session } = await openSettledSession(binary, options);
  return session;
}

async function openResumed(
  binary: string,
  placed: Placed,
  options: SessionOptions,
): Promise<Session> {
  const session = await openSession(binary, {
    ...options,
    cwd: placed.cwd,
    args: ['--resume', placed.id],
  });
  try {
    const landed = await poll(
      () =>
        session.frames().some((frame) => frame.text.includes(placed.marker)) ||
        asksForTrust(session.frames())
          ? true
          : undefined,
      LAND_TIMEOUT_MS,
    );
    if (landed === undefined) {
      throw new Error(
        `the last reply of the resumed session never showed within ${LAND_TIMEOUT_MS}ms`,
      );
    }
    if (asksForTrust(session.frames())) {
      throw new Error(
        `Droid asks whether to trust ${placed.cwd}; start droid in ${path.dirname(placed.cwd)} once and trust the folder`,
      );
    }
    await session.quiet(QUIET_MS, LAND_TIMEOUT_MS);
    await session.quiet(SETTLE_MS, SETTLE_TIMEOUT_MS);
    session.mark();
    return session;
  } catch (error) {
    await session.close();
    throw error;
  }
}

export async function inSession<T>({
  binary,
  plan,
  turns,
  firstCall,
  drive,
}: Setup<T>): Promise<T> {
  const started = startStubModel(plan, firstCall);
  const stub = firstCall === undefined ? started : keepToolCallForTurn(started);
  mkdirSync(CWD_ROOT, { recursive: true });
  const dir = mkdtempSync(path.join(CWD_ROOT, 'cwd-'));
  const file = path.join(dir, 'settings.json');
  writeFileSync(file, JSON.stringify(stubSettings(stub.url)));
  const placed = turns > 0 ? place(turns) : undefined;
  const chunks: Chunk[] = [];
  const options: SessionOptions = {
    env: { FACTORY_RUNTIME_SETTINGS_PATH: file },
    onData: (text) => {
      chunks.push({ atMs: performance.now(), text });
    },
  };
  try {
    const session = await (placed === undefined
      ? openFresh(binary, { ...options, cwd: dir })
      : openResumed(binary, placed, options));
    try {
      return await drive({ session, stub, chunks });
    } finally {
      await session.close();
    }
  } finally {
    await stub.stop();
    rmSync(dir, { recursive: true, force: true });
    if (placed !== undefined) {
      remove(placed);
    }
  }
}
