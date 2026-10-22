import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';

import type { Command } from 'commander';

import { guard, say } from '../cli.ts';
import { TERMINAL_SIZE } from './launch.ts';
import { withLiveDir } from './live-session.ts';
import type { FrameName, Marker, PaintFixture, PaintFrames } from './paint-markers.ts';
import {
  describeFrame,
  describeResult,
  FRAME_NAMES,
  missingMarkers,
  NARROW_COLS,
  paintMarkers,
  readPaint,
  UPDATE_FILE_UNDER_HOME,
} from './paint-markers.ts';
import { poll } from './poll.ts';
import { send, settle, startStub } from './rewind.ts';
import type { Session } from './session.ts';
import { openSettledSession } from './session.ts';
import { stubSettings } from './stub-model.ts';

const PROMPT = 'hello';
const TURN_REPLY = /⛬\s+ok/u;
const MARKER_TIMEOUT_MS = 10_000;
const TURN_TIMEOUT_MS = 30_000;
const CLEAR_COMMAND = '/clear';
const COMMITTED = 'one\ntwo\nthree\n';
const CHANGED = 'one\nTWO\nthree\nfour\n';
const CHANGED_FILE = 'notes.txt';

export const PAINT_FIXTURE: PaintFixture = {
  updateVersion: '0.0.0-ovrdroid-paint-probe',
  additions: 2,
  deletions: 1,
};

const GIT_IDENTITY = [
  '-c',
  'user.name=probe',
  '-c',
  'user.email=probe@example.invalid',
  '-c',
  'commit.gpgsign=false',
  '-c',
  'core.hooksPath=/dev/null',
];

async function git(cwd: string, args: readonly string[]): Promise<void> {
  const child = Bun.spawn(['git', ...GIT_IDENTITY, ...args], {
    cwd,
    stdout: 'ignore',
    stderr: 'pipe',
  });
  const [stderr] = await Promise.all([new Response(child.stderr).text(), child.exited]);
  if (child.exitCode !== 0) {
    throw new Error(`git ${args.join(' ')} failed: ${stderr.trim()}`);
  }
}

async function makeRepo(dir: string): Promise<string> {
  const repo = path.join(dir, 'repo');
  mkdirSync(repo);
  await git(repo, ['init', '--quiet']);
  writeFileSync(path.join(repo, CHANGED_FILE), COMMITTED);
  await git(repo, ['add', '--all']);
  await git(repo, ['commit', '--quiet', '-m', 'probe']);
  writeFileSync(path.join(repo, CHANGED_FILE), CHANGED);
  return repo;
}

function announceUpdate(version: string): () => void {
  const file = path.join(homedir(), UPDATE_FILE_UNDER_HOME);
  const announced = JSON.stringify({ version });
  const found = existsSync(file) ? readFileSync(file, 'utf-8') : undefined;
  const before = found === announced ? undefined : found;
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, announced);
  return () => {
    if (!existsSync(file) || readFileSync(file, 'utf-8') !== announced) {
      return;
    }
    if (before === undefined) {
      rmSync(file, { force: true });
    } else {
      writeFileSync(file, before);
    }
  };
}

async function frameShowing(
  session: Session,
  markers: readonly Marker[],
  frame: FrameName,
): Promise<readonly string[]> {
  const wanted = markers.filter((marker) => marker.frame === frame);
  const shown = await poll(() => {
    const lines = session.screen();
    return wanted.every((marker) => marker.found(lines)) ? lines : undefined;
  }, MARKER_TIMEOUT_MS);
  return shown ?? session.screen();
}

async function driveFrames(session: Session, markers: readonly Marker[]): Promise<PaintFrames> {
  const launch = await frameShowing(session, markers, 'launch');
  await send(session, PROMPT);
  const replied = await poll(
    () => (session.screen().some((line) => TURN_REPLY.test(line)) ? true : undefined),
    TURN_TIMEOUT_MS,
  );
  const turn = replied === undefined ? undefined : await frameShowing(session, markers, 'turn');
  await settle(session);
  session.resize(NARROW_COLS, TERMINAL_SIZE.rows);
  await settle(session);
  await send(session, CLEAR_COMMAND);
  await settle(session);
  const narrow = await frameShowing(session, markers, 'narrow');
  return { launch, turn, narrow };
}

export async function capturePaint(
  binary: string,
  markers: readonly Marker[],
): Promise<PaintFrames> {
  const stub = startStub((tag) => `toolu_paint_${tag}`);
  try {
    return await withLiveDir('paint', async (dir) => {
      const repo = await makeRepo(dir);
      const settings = path.join(dir, 'settings.json');
      writeFileSync(settings, JSON.stringify(stubSettings(stub.url)));
      const restore = announceUpdate(PAINT_FIXTURE.updateVersion);
      try {
        const { session } = await openSettledSession(binary, {
          cwd: repo,
          env: { FACTORY_RUNTIME_SETTINGS_PATH: settings },
          screen: true,
        });
        try {
          return await driveFrames(session, markers);
        } finally {
          await session.close();
        }
      } finally {
        restore();
      }
    });
  } finally {
    await stub.stop();
  }
}

export async function paint(binary: string): Promise<void> {
  const markers = paintMarkers(PAINT_FIXTURE);
  say(
    `launch in a git repo with an uncommitted +${PAINT_FIXTURE.additions} -${PAINT_FIXTURE.deletions} change and an update notice for v${PAINT_FIXTURE.updateVersion}, run one turn on a stub model, then /clear at ${NARROW_COLS} columns: is every painted patch on screen?`,
  );
  const frames = await capturePaint(binary, markers);
  for (const result of readPaint(frames, markers)) {
    say(describeResult(result));
  }
  const missing = missingMarkers(frames, markers);
  if (missing.length > 0) {
    const shown = new Set(missing.map((result) => result.marker.frame));
    for (const name of FRAME_NAMES.filter((frame) => shown.has(frame))) {
      say(`\n${describeFrame(name, frames[name])}`);
    }
    process.exitCode = 1;
  }
}

export function registerPaintCommand(program: Command): void {
  program
    .command('paint')
    .description(
      'launch in a PTY, run one stub-model turn, then /clear at a narrow width: does every patch that paints text show it (wordmark, compact wordmark, update notice, diff stats, turn clock, cache clock)? Writes a fake update notice to the update file for the run and restores it',
    )
    .argument('<binary>')
    .action(guard(paint));
}
