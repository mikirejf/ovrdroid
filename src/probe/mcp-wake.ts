import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

import { MS_PER_SECOND } from '../cli.ts';
import { MCP_IDLE_ENV } from '../patch/mcp-idle-patches.ts';
import type { LaunchEnv } from './launch.ts';
import { FIXTURE_TOOL_NAME } from './mcp-fixture.ts';
import { nextModelCall, writeStubSettings } from './mcp-tool-turn.ts';
import type { AwakeCheck } from './mcp-tool-turn.ts';
import {
  CHILD_SCOPE,
  CHILD_WORD,
  FIRST_SCOPE,
  FIRST_WORD,
  LAUNCH_WORD,
  launchesSubagent,
  roleOf,
  STOP_LIMIT_MS,
  WAKE_IDLE_MS,
  WAKE_SCOPE,
  WAKE_WORD,
} from './mcp-wake-report.ts';
import type { StagedRequest, WakeEvidence } from './mcp-wake-report.ts';
import { droidFileText } from './rewind.ts';
import { ENTER, openSettledSession } from './session.ts';
import type { Session } from './session.ts';
import { streamEvents, toolEvents } from './stub-model.ts';
import type { ToolCall } from './stub-model.ts';
import { offeredTypes } from './subagents-setup.ts';

const DROID_TYPE = 'ovrdroid-mcp-wake-probe';
const TASK_TOOL = 'Task';
const TURN_TIMEOUT_MS = 60 * MS_PER_SECOND;
const STOP_POLL_MS = 250;
const QUIET_MS = 1500;
const QUIET_TIMEOUT_MS = 20_000;

const TASK_CALL: ToolCall = {
  id: 'toolu_mcp_task',
  name: TASK_TOOL,
  input: {
    subagent_type: DROID_TYPE,
    description: 'ping the fixture',
    prompt: `${CHILD_WORD} call the fixture tool`,
  },
};

interface WakeStub {
  url: string;
  childDone: Promise<boolean>;
  firstAnswered: Promise<number>;
  woken: Promise<boolean>;
  childSawRunning: () => boolean | undefined;
  requests: () => readonly StagedRequest[];
  stop: () => Promise<void>;
}

function eventStream(events: readonly string[]): Response {
  return new Response(events.join(''), { headers: { 'content-type': 'text/event-stream' } });
}

function scopeOf(role: 'child' | 'first' | 'wake') {
  if (role === 'child') {
    return CHILD_SCOPE;
  }
  return role === 'first' ? FIRST_SCOPE : WAKE_SCOPE;
}

function serveWakeTurns(toolName: string, isAwake: AwakeCheck, root: Promise<number>): WakeStub {
  const requests: StagedRequest[] = [];
  const childDone = Promise.withResolvers<boolean>();
  const firstAnswered = Promise.withResolvers<number>();
  const woken = Promise.withResolvers<boolean>();
  let childSawRunning: boolean | undefined;
  const server = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    async fetch(request) {
      if (request.method !== 'POST' || !new URL(request.url).pathname.endsWith('/messages')) {
        return new Response('not found', { status: 404 });
      }
      const body: unknown = await request.json();
      const role = roleOf(body);
      requests.push({ role, body });
      if (role === 'plain') {
        return eventStream(streamEvents(['ok']));
      }
      if (role === 'launch') {
        if (launchesSubagent(body)) {
          return eventStream(toolEvents(TASK_CALL));
        }
        return eventStream(streamEvents(['done']));
      }
      if (role === 'child' && childSawRunning === undefined) {
        childSawRunning = await isAwake(await root);
      }
      const call = nextModelCall(body, toolName, scopeOf(role));
      if (call === undefined) {
        if (role === 'child') {
          childDone.resolve(true);
        } else if (role === 'first') {
          firstAnswered.resolve(performance.now());
        } else {
          woken.resolve(true);
        }
        return eventStream(streamEvents(['done']));
      }
      return eventStream(toolEvents(call));
    },
  });
  return {
    url: `http://127.0.0.1:${server.port}`,
    childDone: childDone.promise,
    firstAnswered: firstAnswered.promise,
    woken: woken.promise,
    childSawRunning: () => childSawRunning,
    requests: () => requests,
    stop: async () => {
      await server.stop(true);
    },
  };
}

async function within<T>(done: Promise<T>, ms: number): Promise<T | undefined> {
  const cancel = new AbortController();
  try {
    return await Promise.race([done, delay(ms, undefined, { signal: cancel.signal })]);
  } finally {
    cancel.abort();
  }
}

async function goneBefore(
  isAwake: AwakeCheck,
  root: number,
  deadline: number,
): Promise<number | undefined> {
  let gone: number | undefined;
  while (gone === undefined && performance.now() < deadline) {
    // oxlint-disable-next-line no-await-in-loop
    if (await isAwake(root)) {
      // oxlint-disable-next-line no-await-in-loop
      await delay(STOP_POLL_MS);
    } else {
      gone = performance.now();
    }
  }
  return gone;
}

async function send(session: Session, prompt: string): Promise<void> {
  await session.type(prompt);
  await session.type(ENTER);
}

export interface WakeRun {
  dir: string;
  isAwake: AwakeCheck;
  env: LaunchEnv;
}

async function drive(session: Session, stub: WakeStub, isAwake: AwakeCheck): Promise<WakeEvidence> {
  const evidence = (rest: Partial<WakeEvidence> = {}): WakeEvidence => ({
    requests: stub.requests(),
    childSawRunning: stub.childSawRunning(),
    quietBeforeFirst: false,
    stoppedAfterMs: undefined,
    ...rest,
  });
  await send(session, `${LAUNCH_WORD} run the sub-agent`);
  if ((await within(stub.childDone, TURN_TIMEOUT_MS)) !== true) {
    return evidence();
  }
  const quiet = await goneBefore(isAwake, session.pid, performance.now() + STOP_LIMIT_MS);
  if (quiet === undefined) {
    return evidence();
  }
  await session.quiet(QUIET_MS, QUIET_TIMEOUT_MS);
  await send(session, `${FIRST_WORD} call the fixture tool`);
  const answeredAt = await within(stub.firstAnswered, TURN_TIMEOUT_MS);
  if (answeredAt === undefined) {
    return evidence({ quietBeforeFirst: true });
  }
  const goneAt = await goneBefore(isAwake, session.pid, answeredAt + STOP_LIMIT_MS);
  if (goneAt === undefined) {
    return evidence({ quietBeforeFirst: true });
  }
  await session.quiet(QUIET_MS, QUIET_TIMEOUT_MS);
  await send(session, `${WAKE_WORD} call the fixture tool again`);
  await within(stub.woken, TURN_TIMEOUT_MS);
  return evidence({ quietBeforeFirst: true, stoppedAfterMs: goneAt - answeredAt });
}

export async function wakeSession(
  binary: string,
  { dir, isAwake, env }: WakeRun,
): Promise<WakeEvidence> {
  const droids = path.join(dir, '.factory', 'droids');
  mkdirSync(droids, { recursive: true });
  writeFileSync(path.join(droids, `${DROID_TYPE}.md`), droidFileText(DROID_TYPE));
  if (!offeredTypes(dir).includes(DROID_TYPE)) {
    throw new Error(`Droid would not offer the project-local droid ${DROID_TYPE} in ${droids}`);
  }
  const root = Promise.withResolvers<number>();
  const stub = serveWakeTurns(FIXTURE_TOOL_NAME, isAwake, root.promise);
  try {
    const { session } = await openSettledSession(binary, {
      cwd: dir,
      collect: false,
      env: {
        ...env,
        FACTORY_RUNTIME_SETTINGS_PATH: writeStubSettings(dir, 'wake', stub.url),
        [MCP_IDLE_ENV]: String(WAKE_IDLE_MS),
      },
    });
    root.resolve(session.pid);
    try {
      return await drive(session, stub, isAwake);
    } finally {
      await session.close();
    }
  } finally {
    await stub.stop();
  }
}
