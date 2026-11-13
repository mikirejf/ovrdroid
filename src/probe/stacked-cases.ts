import { randomUUID } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import path from 'node:path';

import { withLiveDir } from './live-session.ts';
import { send, settle, waitFor } from './rewind.ts';
import type { Session } from './session.ts';
import { ENTER, openSettledSession } from './session.ts';
import {
  APPROVAL_COMMAND,
  CASE_REQUESTS,
  readApproval,
  readSwitch,
} from './stacked-cases-report.ts';
import type { ApprovalCapture, SwitchCapture } from './stacked-cases-report.ts';
import type { Finding } from './stacked-report.ts';
import { toolNamesIn } from './stale-edit-cases.ts';
import { streamEvents, stubSettings, toolBatchEvents } from './stub-model.ts';
import type { ToolCall } from './stub-model.ts';

const MODEL = 'stub-stacked-cases';
const STUB_NAME = 'Stub Stream';
const PROMPT = 'Go through the files.';
const ESC = '\u001B';
const STEP_TIMEOUT_MS = 30_000;
const FRAME_QUIET_MS = 800;
const FRAME_TIMEOUT_MS = 5000;
const KEY_REACT_MS = 500;
const SETTING_FILTER = 'tool result';
const EXECUTE_REQUEST = 2;

interface CaseStub {
  url: string;
  served: () => number;
  stop: () => Promise<void>;
}

function eventStream(events: readonly string[]): Response {
  return new Response(events.join(''), { headers: { 'content-type': 'text/event-stream' } });
}

function startCaseStub(calls: readonly ToolCall[]): CaseStub {
  let count = 0;
  const server = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    async fetch(request) {
      if (request.method !== 'POST' || !new URL(request.url).pathname.endsWith('/messages')) {
        return new Response('not found', { status: 404 });
      }
      if (toolNamesIn(await request.json()).length === 0) {
        return eventStream(streamEvents(['ok']));
      }
      const call = calls[count];
      count += 1;
      return eventStream(call === undefined ? streamEvents(['done']) : toolBatchEvents([call]));
    },
  });
  return {
    url: `http://127.0.0.1:${server.port}`,
    served: () => count,
    stop: async () => {
      await server.stop(true);
    },
  };
}

interface Case<T> {
  binary: string;
  command: string;
  settings?: { commandDenylist: string[] };
  drive: (session: Session, stub: CaseStub) => Promise<T>;
}

function readExecuteRead(dir: string, command: string): ToolCall[] {
  const token = randomUUID().slice(0, 8);
  const read = (name: string) => ({ name: 'Read', input: { file_path: path.join(dir, name) } });
  const calls = [
    read('a.txt'),
    { name: 'Execute', input: { command, riskLevel: 'low' } },
    read('b.txt'),
  ];
  return calls.map((call, index) =>
    Object.assign(call, { id: `toolu_stackedcase${token}_${index}` }),
  );
}

async function runCase<T>(job: Case<T>): Promise<T> {
  return await withLiveDir('stacked-case', async (dir) => {
    for (const name of ['a.txt', 'b.txt']) {
      writeFileSync(path.join(dir, name), `plain ${name}\n`);
    }
    const stub = startCaseStub(readExecuteRead(dir, job.command));
    try {
      const settings = path.join(dir, 'settings.json');
      writeFileSync(
        settings,
        JSON.stringify({
          ...stubSettings(stub.url, MODEL),
          toolResultDisplay: 'stacked',
          ...job.settings,
        }),
      );
      const { session } = await openSettledSession(job.binary, {
        cwd: dir,
        env: {
          FACTORY_RUNTIME_SETTINGS_PATH: settings,
          FACTORY_DISABLE_SETTINGS_PERSISTENCE: 'true',
        },
        screen: true,
      });
      try {
        if (!session.screen().some((line) => line.includes(STUB_NAME))) {
          throw new Error(
            `${job.binary} did not take the probe's settings (the status bar does not name '${STUB_NAME}'), so the prompt was not sent: it would reach a real model`,
          );
        }
        return await job.drive(session, stub);
      } finally {
        await session.close().catch(() => null);
      }
    } finally {
      await stub.stop();
    }
  });
}

async function answered(stub: CaseStub, count: number): Promise<void> {
  await waitFor(
    `the stub model answered ${stub.served()} of ${count} requests`,
    () => (stub.served() >= count ? true : undefined),
    STEP_TIMEOUT_MS,
  );
}

async function frame(session: Session): Promise<string[]> {
  await Bun.sleep(KEY_REACT_MS);
  await session.quiet(FRAME_QUIET_MS, FRAME_TIMEOUT_MS);
  return session.screen();
}

const ALT_UP = '\u001B[1;3A';

export interface ScrollCapture {
  scrollView: readonly string[];
  afterScroll: readonly string[];
}

async function frameAfter(session: Session, key: string): Promise<string[]> {
  session.press(key);
  return await frame(session);
}

export async function captureScrollView(session: Session): Promise<ScrollCapture> {
  const scrollView = await frameAfter(session, ALT_UP);
  const afterScroll = await frameAfter(session, ESC);
  return { scrollView, afterScroll };
}

async function captureApproval(binary: string): Promise<ApprovalCapture> {
  return await runCase({
    binary,
    command: APPROVAL_COMMAND,
    settings: { commandDenylist: [APPROVAL_COMMAND] },
    drive: async (session, stub) => {
      await send(session, PROMPT);
      await answered(stub, EXECUTE_REQUEST);
      const pending = await frame(session);
      session.press(ENTER);
      await answered(stub, CASE_REQUESTS);
      await settle(session);
      return { served: stub.served(), pending, screen: session.screen() };
    },
  });
}

async function cycleSetting(session: Session, presses: number): Promise<string[]> {
  await send(session, '/settings');
  await frame(session);
  await session.type(SETTING_FILTER);
  await frame(session);
  for (let press = 0; press < presses; press += 1) {
    session.press(ENTER);
    // oxlint-disable-next-line no-await-in-loop
    await frame(session);
  }
  session.press(ESC);
  await frame(session);
  session.press(ESC);
  return await frame(session);
}

async function captureSwitch(binary: string): Promise<SwitchCapture> {
  return await runCase({
    binary,
    command: 'true',
    drive: async (session, stub) => {
      await send(session, PROMPT);
      await answered(stub, CASE_REQUESTS);
      await settle(session);
      const stacked = session.screen();
      const expanded = await cycleSetting(session, 1);
      const back = await cycleSetting(session, 2);
      return { served: stub.served(), stacked, expanded, back };
    },
  });
}

export interface CaseRun {
  findings: Finding[];
  frames: [string, readonly string[]][];
}

export async function runStackedCases(binary: string): Promise<CaseRun> {
  const approval = await captureApproval(binary);
  const switched = await captureSwitch(binary);
  return {
    findings: [...readApproval(approval), ...readSwitch(switched)],
    frames: [
      ['while the Execute waits for approval', approval.pending],
      ['after approving it', approval.screen],
      ['stacked before switching', switched.stacked],
      ['after switching to expanded', switched.expanded],
      ['after switching back to stacked', switched.back],
    ],
  };
}
