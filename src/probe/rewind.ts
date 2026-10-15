import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

import { MS_PER_SECOND } from '../cli.ts';
import { FACTORY_DROIDS, FACTORY_SESSIONS, FACTORY_TASK_INVOCATIONS } from '../paths.ts';
import { makeTempDir } from '../temp.ts';
import { entriesOf, fieldsOf, fieldsOfJson, worded } from './fields.ts';
import { sessionFolderName } from './ledger.ts';
import { poll } from './poll.ts';
import type {
  ChatFiles,
  RewindEvidence,
  StubAnswer,
  TaskRecord,
  TaskTag,
} from './rewind-report.ts';
import {
  answerFor,
  CHECK_WORD,
  HOLD_WORD,
  LAUNCH_WORD,
  TASK_TAGS,
  titleOf,
} from './rewind-report.ts';
import type { Session } from './session.ts';
import { ENTER, openSettledSession } from './session.ts';
import { streamEvents, stubSettings, toolEvents } from './stub-model.ts';

const DROID_TYPE = 'ovrdroid-rewind-probe';
const DROID_FILE = `---\nname: ${DROID_TYPE}\ndescription: Says hi for the rewind probe.\nmodel: inherit\n---\nSay hi.\n`;
const REWIND_COMMAND = '/rewind-conversation';
const BACKSPACE = '\u007F';
const CLEAR_KEYS = 30;
const MENU_SETTLE_MS = 400;
const QUIET_MS = 1500;
const QUIET_TIMEOUT_MS = 20_000;
const STEP_TIMEOUT_MS = 30_000;
const FOOTER_ROWS = 15;
const HELD: readonly TaskTag[] = ['kept', 'cut'];
const ACTIVE = new Set(['pending', 'running']);

function launchPrompt(tag: TaskTag): string {
  return `${LAUNCH_WORD} ${tag}`;
}

const AFTER_PROMPT = launchPrompt('after');

export const DEFAULT_REWIND_TIMEOUT_S = 60;

export interface RewindOptions {
  cwd: string;
  timeout: number;
}

interface Stub {
  url: string;
  release: () => void;
  stop: () => Promise<void>;
}

function eventsFor(answer: StubAnswer, callId: (tag: string) => string): string[] {
  if (answer.kind === 'launch') {
    return toolEvents({
      id: callId(answer.tag),
      name: 'Task',
      input: {
        subagent_type: DROID_TYPE,
        description: `rewind probe ${answer.tag}`,
        prompt: `${HOLD_WORD}${answer.tag}`,
        run_in_background: true,
      },
    });
  }
  if (answer.kind === 'check') {
    return toolEvents({
      id: callId('check'),
      name: 'TaskOutput',
      input: { task_id: answer.taskId, block: false },
    });
  }
  return streamEvents([answer.kind === 'child' ? 'hi' : 'ok']);
}

function startStub(callId: (tag: string) => string): Stub {
  const held = Promise.withResolvers<boolean>();
  const server = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    async fetch(request) {
      if (request.method !== 'POST' || !new URL(request.url).pathname.endsWith('/messages')) {
        return new Response('not found', { status: 404 });
      }
      const answer = answerFor(await request.json());
      if (answer.kind === 'child' && HELD.some((tag) => tag === answer.tag)) {
        await held.promise;
      }
      return new Response(eventsFor(answer, callId).join(''), {
        headers: { 'content-type': 'text/event-stream' },
      });
    },
  });
  return {
    url: `http://127.0.0.1:${server.port}`,
    release: () => {
      held.resolve(true);
    },
    stop: async () => {
      held.resolve(true);
      await server.stop(true);
    },
  };
}

function readText(file: string): string {
  return existsSync(file) ? readFileSync(file, 'utf-8') : '';
}

function taskRecord(callId: string): TaskRecord | undefined {
  const store = fieldsOfJson(readText(FACTORY_TASK_INVOCATIONS));
  const entry = entriesOf(store, 'invocations').find(
    (invocation) => worded(invocation, 'parentToolUseId') === callId,
  );
  return entry === undefined
    ? undefined
    : {
        parentSessionId: worded(entry, 'parentSessionId'),
        childSessionId: worded(entry, 'childSessionId'),
        status: worded(entry, 'status'),
      };
}

function chatFiles(folder: string, id: string): ChatFiles {
  return {
    transcript: readText(path.join(folder, `${id}.jsonl`)),
    settings: readText(path.join(folder, `${id}.settings.json`)),
  };
}

function childTagParent(child: string): string | undefined {
  for (const file of new Bun.Glob(`*/${child}.settings.json`).scanSync(FACTORY_SESSIONS)) {
    const tags = entriesOf(fieldsOfJson(readText(path.join(FACTORY_SESSIONS, file))), 'tags');
    const subagent = tags.find((tag) => worded(tag, 'name') === 'subagent');
    return subagent === undefined
      ? undefined
      : worded(fieldsOf(subagent.get('metadata')), 'callingSessionId');
  }
  return undefined;
}

function transcriptOf(session: string | undefined): string {
  if (session === undefined) {
    return '';
  }
  for (const file of new Bun.Glob(`*/${session}.jsonl`).scanSync(FACTORY_SESSIONS)) {
    return readText(path.join(FACTORY_SESSIONS, file));
  }
  return '';
}

function forkOf(folder: string, oldChat: string): string | undefined {
  for (const file of new Bun.Glob('*.jsonl').scanSync(folder)) {
    const [first = ''] = readText(path.join(folder, file)).split('\n', 1);
    const start = fieldsOfJson(first);
    if (worded(start, 'type') === 'session_start' && worded(start, 'parent') === oldChat) {
      return worded(start, 'id');
    }
  }
  return undefined;
}

async function waitFor<T>(what: string, read: () => T | undefined, timeoutMs: number): Promise<T> {
  const value = await poll(read, timeoutMs);
  if (value === undefined) {
    throw new Error(`${what} within ${timeoutMs / MS_PER_SECOND}s`);
  }
  return value;
}

async function send(session: Session, text: string): Promise<void> {
  await session.type(text);
  await session.type(ENTER);
}

async function settle(session: Session): Promise<void> {
  await session.quiet(QUIET_MS, QUIET_TIMEOUT_MS);
}

async function launchTask(session: Session, tag: TaskTag, callId: string): Promise<TaskRecord> {
  await send(session, launchPrompt(tag));
  const record = await waitFor(
    `no ${tag} agent started`,
    () => taskRecord(callId),
    STEP_TIMEOUT_MS,
  );
  await settle(session);
  return record;
}

async function rewindToLastMessage(session: Session): Promise<void> {
  await session.type(REWIND_COMMAND);
  await delay(MENU_SETTLE_MS);
  await session.type(ENTER);
  await settle(session);
  await session.type(ENTER);
  await settle(session);
  await session.type(BACKSPACE.repeat(CLEAR_KEYS));
  await settle(session);
}

function finished(callId: string): boolean {
  const record = taskRecord(callId);
  return record !== undefined && !ACTIVE.has(record.status);
}

function noticeLanded(folder: string, chats: readonly string[], child: string): boolean {
  return chats.some((chat) => chatFiles(folder, chat).transcript.includes(`task_id: ${child}`));
}

interface Drive {
  session: Session;
  folder: string;
  callId: (tag: string) => string;
  release: () => void;
  timeoutMs: number;
}

interface Chats {
  oldChat: string;
  newChat: string;
  titleAtRewind: string;
}

function evidenceFrom(drive: Drive, { oldChat, newChat, titleAtRewind }: Chats) {
  const tasks: Partial<Record<TaskTag, TaskRecord>> = {};
  const childTagParents: Partial<Record<TaskTag, string>> = {};
  for (const tag of TASK_TAGS) {
    const record = taskRecord(drive.callId(tag));
    if (record !== undefined) {
      tasks[tag] = record;
      const parent = childTagParent(record.childSessionId);
      if (parent !== undefined) {
        childTagParents[tag] = parent;
      }
    }
  }
  const fresh = chatFiles(drive.folder, newChat);
  return {
    oldChat,
    newChat,
    chats: { old: chatFiles(drive.folder, oldChat), new: fresh },
    tasks,
    childTagParents,
    checkCallId: drive.callId('check'),
    active: {
      prompt: AFTER_PROMPT,
      afterCallId: drive.callId('after'),
      keptChildTranscript: transcriptOf(tasks.kept?.childSessionId),
      afterChildTranscript: transcriptOf(tasks.after?.childSessionId),
      titleAtRewind,
      titleAtEnd: titleOf(fresh.transcript),
    },
  };
}

async function driveRewind(drive: Drive): Promise<RewindEvidence> {
  const { session, folder, callId, timeoutMs } = drive;
  const kept = await launchTask(session, 'kept', callId('kept'));
  const oldChat = kept.parentSessionId;
  await launchTask(session, 'cut', callId('cut'));
  await rewindToLastMessage(session);
  const newChat = await waitFor(
    'the rewind made no new chat',
    () => forkOf(folder, oldChat),
    STEP_TIMEOUT_MS,
  );
  const footer = session.screen().slice(-FOOTER_ROWS);
  const titleAtRewind = titleOf(chatFiles(folder, newChat).transcript);

  await send(session, `${CHECK_WORD} ${kept.childSessionId}`);
  await waitFor(
    'TaskOutput never answered',
    () => (chatFiles(folder, newChat).transcript.includes(callId('check')) ? true : undefined),
    STEP_TIMEOUT_MS,
  );
  await settle(session);
  await launchTask(session, 'after', callId('after'));

  drive.release();
  await waitFor(
    'the held agents never finished',
    () => (HELD.every((tag) => finished(callId(tag))) ? true : undefined),
    timeoutMs,
  );
  await poll(
    () => (noticeLanded(folder, [oldChat, newChat], kept.childSessionId) ? true : undefined),
    timeoutMs,
  );
  await settle(session);
  return { ...evidenceFrom(drive, { oldChat, newChat, titleAtRewind }), footer };
}

export async function runRewind(binary: string, options: RewindOptions): Promise<RewindEvidence> {
  const run = randomUUID().slice(0, 8);
  const callId = (tag: string) => `toolu_rewind${run}_${tag}`;
  const droidFile = path.join(FACTORY_DROIDS, `${DROID_TYPE}.md`);
  const dir = makeTempDir('rewind');
  const stub = startStub(callId);
  try {
    mkdirSync(FACTORY_DROIDS, { recursive: true });
    writeFileSync(droidFile, DROID_FILE);
    const settingsFile = path.join(dir, 'settings.json');
    writeFileSync(settingsFile, JSON.stringify(stubSettings(stub.url)));
    const { session } = await openSettledSession(binary, {
      cwd: options.cwd,
      env: { FACTORY_RUNTIME_SETTINGS_PATH: settingsFile },
      screen: true,
    });
    try {
      return await driveRewind({
        session,
        folder: path.join(FACTORY_SESSIONS, sessionFolderName(realpathSync(options.cwd))),
        callId,
        release: stub.release,
        timeoutMs: options.timeout * MS_PER_SECOND,
      });
    } finally {
      await session.close();
    }
  } finally {
    await stub.stop();
    rmSync(dir, { recursive: true, force: true });
    rmSync(droidFile, { force: true });
  }
}
