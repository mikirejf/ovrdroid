import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { userInfo } from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

import { cacheDir, FACTORY_SESSIONS } from '../paths.ts';
import type { Counted, Measured } from './counter-file.ts';
import { endSpan, withCounters } from './counter-file.ts';
import type { Span } from './counters.ts';
import type { LaunchEnv } from './launch.ts';
import { TERMINAL_SIZE } from './launch.ts';
import { sessionFolderName } from './ledger.ts';
import { resumeFixture } from './resume-fixture.ts';
import type { RedrawReading, ResumeRun } from './resume-report.ts';
import { asksForTrust, readRedraw, readResume, redrawn } from './resume-report.ts';
import type { Session } from './session.ts';
import { openSession } from './session.ts';
import { sampleTree } from './tree-samples.ts';

export const QUIET_MS = 1500;
const LAND_TIMEOUT_MS = 30_000;
const REDRAW_TIMEOUT_MS = 10_000;
const POLL_MS = 50;
export const RESIZE_COLS = 100;
const CWD_ROOT = cacheDir('resume');

export interface ResumeOptions {
  turns: number;
}

interface Placed {
  id: string;
  cwd: string;
  folder: string;
  marker: string;
}

function place(turns: number): Placed {
  mkdirSync(CWD_ROOT, { recursive: true });
  const cwd = realpathSync(mkdtempSync(path.join(CWD_ROOT, 'cwd-')));
  const folder = path.join(FACTORY_SESSIONS, sessionFolderName(cwd));
  try {
    mkdirSync(folder);
  } catch (error) {
    rmSync(cwd, { recursive: true, force: true });
    throw error;
  }
  const id = crypto.randomUUID();
  const fixture = resumeFixture({ id, cwd, owner: userInfo().username, turns });
  writeFileSync(path.join(folder, `${id}.jsonl`), fixture.transcript);
  return { id, cwd, folder, marker: fixture.lastMarker };
}

function remove(placed: Placed): void {
  rmSync(placed.folder, { recursive: true, force: true });
  rmSync(placed.cwd, { recursive: true, force: true });
}

async function treeCpuMs(root: number): Promise<number> {
  const samples = await sampleTree(root);
  return samples.reduce((sum, sample) => sum + sample.cpuMs, 0);
}

async function until(done: () => boolean, timeoutMs: number): Promise<boolean> {
  const deadline = performance.now() + timeoutMs;
  while (!done() && performance.now() < deadline) {
    // oxlint-disable-next-line no-await-in-loop
    await delay(POLL_MS);
  }
  return done();
}

function shows(session: Session, marker: string): boolean {
  return session.frames().some((frame) => frame.text.includes(marker));
}

interface Redraw {
  reading: RedrawReading;
  span: Span;
}

async function measureRedraw(session: Session, marker: string): Promise<Redraw> {
  const before = await treeCpuMs(session.pid);
  session.mark();
  const resizedAt = performance.now();
  session.resize(RESIZE_COLS, TERMINAL_SIZE.rows);
  await until(() => redrawn(session.frames(), marker, RESIZE_COLS), REDRAW_TIMEOUT_MS);
  await session.quiet(QUIET_MS, REDRAW_TIMEOUT_MS);
  const span = await endSpan(resizedAt);
  const after = await treeCpuMs(session.pid);
  const reading = readRedraw(session.frames(), {
    marker,
    cols: RESIZE_COLS,
    bytes: session.bytes(),
    cpuMs: after - before,
  });
  return { reading, span };
}

async function resumeIn(
  binary: string,
  placed: Placed,
  env: LaunchEnv,
): Promise<Measured<ResumeRun>> {
  const openedAt = performance.now();
  const session = await openSession(binary, {
    args: ['--resume', placed.id],
    cwd: placed.cwd,
    env,
  });
  try {
    const { marker } = placed;
    await until(() => asksForTrust(session.frames()) || shows(session, marker), LAND_TIMEOUT_MS);
    if (asksForTrust(session.frames())) {
      throw new Error(
        `Droid asks whether to trust ${placed.cwd}. Trust ${CWD_ROOT} once (start droid there and pick "Trust this folder"), then run again`,
      );
    }
    await session.quiet(QUIET_MS, LAND_TIMEOUT_MS);
    const cpuMs = await treeCpuMs(session.pid);
    const reading = readResume(session.frames(), {
      marker,
      spawnOffsetMs: session.startedAt - openedAt,
      bytes: session.bytes(),
    });
    const resume = await endSpan(session.startedAt);
    const redraw = await measureRedraw(session, marker);
    return {
      reading: { ...reading, cpuMs, redraw: redraw.reading },
      spans: { resume, resize: redraw.span },
    };
  } finally {
    await session.close();
  }
}

export async function measureResume(
  binary: string,
  options: ResumeOptions,
): Promise<ResumeRun & Counted> {
  const placed = place(options.turns);
  try {
    return await withCounters(async (env) => await resumeIn(binary, placed, env));
  } finally {
    remove(placed);
  }
}
