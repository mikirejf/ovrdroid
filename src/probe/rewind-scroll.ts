import { existsSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { MS_PER_SECOND, say } from '../cli.ts';
import { FACTORY_SESSIONS } from '../paths.ts';
import { makeTempDir } from '../temp.ts';
import { TERMINAL_SIZE } from './launch.ts';
import { sessionFolderName } from './ledger.ts';
import { poll } from './poll.ts';
import type { ColorReading } from './rewind-scroll-color.ts';
import {
  focusedVerdict,
  readColors,
  restoredColorVerdict,
  unfocusedVerdict,
} from './rewind-scroll-color.ts';
import type { ChatReading, Verdict } from './rewind-scroll-report.ts';
import {
  describeVerdicts,
  forkReading,
  lastAnswerLine,
  promptFor,
  readChat,
  restoredVerdict,
  rewoundVerdict,
  settledVerdict,
  shownVerdict,
  topicsFor,
  untouchedVerdict,
} from './rewind-scroll-report.ts';
import { chatsWith, forkOf, startStub } from './rewind-scroll-world.ts';
import { send, settle, waitFor } from './rewind.ts';
import type { Session } from './session.ts';
import { ENTER, openSettledSession } from './session.ts';

const REWIND_COMMAND = '/rewind-conversation';
const ARROW_DOWN = '\u001B[B';
const ESCAPE = '\u001B';
const MENU_SETTLE_MS = 400;
const NARROW = { cols: 100, rows: 28 } as const;

export const DEFAULT_REWIND_SCROLL_TIMEOUT_S = 30;
export const DEFAULT_REWIND_SCROLL_TURNS = 4;

export interface RewindScrollOptions {
  cwd: string;
  timeout: number;
  turns: number;
  dump: string | undefined;
}

interface Drive {
  session: Session;
  run: string;
  topics: readonly string[];
  folder: string;
  timeoutMs: number;
  screens: Map<string, readonly string[]>;
}

interface Shot {
  chat: ChatReading;
  colors: ColorReading;
}

function snapshot(drive: Drive, label: string): Shot {
  const screen = drive.session.screen();
  drive.screens.set(label, screen);
  return {
    chat: readChat(screen, drive.topics),
    colors: readColors(drive.session.styledScreen()),
  };
}

async function showing(drive: Drive, label: string, topic: string): Promise<Shot> {
  await drive.session.quiet(MENU_SETTLE_MS, drive.timeoutMs);
  await poll(() => {
    const reading = readChat(drive.session.screen(), drive.topics);
    return reading.prompts[0] === topic && reading.historyShown ? true : undefined;
  }, drive.timeoutMs);
  await settle(drive.session);
  return snapshot(drive, label);
}

async function openMenu(drive: Drive): Promise<Shot> {
  await drive.session.type(REWIND_COMMAND);
  await Bun.sleep(MENU_SETTLE_MS);
  await drive.session.type(ENTER);
  await waitFor(
    'the rewind menu did not open',
    () => (readChat(drive.session.screen(), drive.topics).menuOpen ? true : undefined),
    drive.timeoutMs,
  );
  await settle(drive.session);
  return snapshot(drive, 'opened');
}

function down(drive: Drive, times: number): void {
  for (let press = 0; press < times; press++) {
    drive.session.press(ARROW_DOWN);
  }
}

async function sendTurns(drive: Drive): Promise<void> {
  for (const topic of drive.topics) {
    // oxlint-disable-next-line no-await-in-loop
    await send(drive.session, promptFor(topic, drive.run));
    // oxlint-disable-next-line no-await-in-loop
    await waitFor(
      `the ${topic} answer never finished`,
      () =>
        drive.session.screen().some((line) => line.includes(lastAnswerLine(topic)))
          ? true
          : undefined,
      drive.timeoutMs,
    );
    // oxlint-disable-next-line no-await-in-loop
    await settle(drive.session);
  }
}

function topicAt(drive: Drive, fromNewest: number): string {
  const topic = drive.topics.at(-1 - fromNewest);
  if (topic === undefined) {
    throw new RangeError(`no message ${fromNewest} back from the newest`);
  }
  return topic;
}

async function browse(drive: Drive): Promise<Verdict[]> {
  const opened = await openMenu(drive);
  const newest = topicAt(drive, 0);
  const older = topicAt(drive, 2);
  const oldest = topicAt(drive, drive.topics.length - 1);
  down(drive, 2);
  const olderShown = await showing(drive, 'older', older);
  drive.session.resize(NARROW.cols, NARROW.rows);
  await settle(drive.session);
  const afterResize = topicAt(drive, 3);
  down(drive, 1);
  const resized = await showing(drive, 'resized', afterResize);
  drive.session.resize(TERMINAL_SIZE.cols, TERMINAL_SIZE.rows);
  await settle(drive.session);
  down(drive, drive.topics.length - 4);
  const oldestShown = await showing(drive, 'oldest', oldest);
  down(drive, 1);
  const wrapped = await showing(drive, 'wrapped', newest);
  drive.session.press(ESCAPE);
  await poll(
    () => (readChat(drive.session.screen(), drive.topics).menuOpen ? undefined : true),
    drive.timeoutMs,
  );
  await settle(drive.session);
  const restored = snapshot(drive, 'cancelled');
  return [
    untouchedVerdict(opened.chat),
    unfocusedVerdict(opened.colors),
    shownVerdict('two quick Down presses', older, olderShown.chat),
    focusedVerdict('two quick Down presses', older, olderShown.colors),
    shownVerdict(
      `Down after a resize to ${NARROW.cols}x${NARROW.rows} with the menu open`,
      afterResize,
      resized.chat,
    ),
    shownVerdict('quick Down presses to the oldest message', oldest, oldestShown.chat),
    shownVerdict('Down past the oldest message wraps around', newest, wrapped.chat),
    focusedVerdict('Down past the oldest message wraps around', newest, wrapped.colors),
    restoredVerdict(restored.chat, newest),
    restoredColorVerdict(restored.colors, wrapped.colors.focus),
  ];
}

async function rewind(drive: Drive, chatId: string): Promise<Verdict[]> {
  await openMenu(drive);
  const target = topicAt(drive, 1);
  down(drive, 1);
  await showing(drive, 'before-rewind', target);
  await drive.session.type(ENTER);
  const fork = await poll(() => forkOf(drive.folder, chatId), drive.timeoutMs);
  await settle(drive.session);
  const after = snapshot(drive, 'rewound');
  const transcript =
    fork !== undefined && existsSync(fork) ? readFileSync(fork, 'utf-8') : undefined;
  return [
    rewoundVerdict(forkReading(transcript, drive.topics), drive.topics, target),
    settledVerdict(after.chat),
  ];
}

async function runScenario(drive: Drive): Promise<Verdict[]> {
  await sendTurns(drive);
  const [chatId] = chatsWith(drive.folder, drive.run);
  if (chatId === undefined) {
    throw new Error('the probe chat was never saved');
  }
  return [...(await browse(drive)), ...(await rewind(drive, chatId))];
}

function dumpScreens(file: string, screens: ReadonlyMap<string, readonly string[]>): void {
  writeFileSync(
    file,
    [...screens].map(([label, screen]) => `===== ${label}\n${screen.join('\n')}`).join('\n\n'),
  );
}

export async function rewindScroll(binary: string, options: RewindScrollOptions): Promise<void> {
  const run = crypto.randomUUID().slice(0, 8);
  const dir = makeTempDir('rewind-scroll');
  const stub = startStub();
  const screens = new Map<string, readonly string[]>();
  let verdicts: Verdict[] = [];
  try {
    const settingsFile = path.join(dir, 'settings.json');
    writeFileSync(settingsFile, JSON.stringify(stub.settings));
    const { session } = await openSettledSession(binary, {
      cwd: options.cwd,
      env: { FACTORY_RUNTIME_SETTINGS_PATH: settingsFile },
      screen: true,
    });
    try {
      verdicts = await runScenario({
        session,
        run,
        topics: topicsFor(options.turns),
        folder: path.join(FACTORY_SESSIONS, sessionFolderName(realpathSync(options.cwd))),
        timeoutMs: options.timeout * MS_PER_SECOND,
        screens,
      });
    } finally {
      await session.close();
    }
  } finally {
    await stub.stop();
    rmSync(dir, { recursive: true, force: true });
    if (options.dump !== undefined) {
      dumpScreens(options.dump, screens);
    }
  }
  say(describeVerdicts(verdicts));
  if (verdicts.some((verdict) => !verdict.pass)) {
    process.exitCode = 1;
  }
}
