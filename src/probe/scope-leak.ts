import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

import { MS_PER_SECOND } from '../cli.ts';
import { FACTORY_DROIDS } from '../paths.ts';
import { makeTempDir } from '../temp.ts';
import { LOG_PATH } from './effort-switch-turn.ts';
import { logSize, logSlice } from './log-file.ts';
import { droidFilePath, send, settle, waitFor } from './rewind.ts';
import type { MainTurn, ScopeLeakRun, StubTurn } from './scope-leak-report.ts';
import { HOLD_WORD, LAUNCH_WORD, logEvents, mainTurnFor, turnFor } from './scope-leak-report.ts';
import type { Session } from './session.ts';
import { openSettledSession } from './session.ts';
import { streamEvents, stubSettings, toolEvents } from './stub-model.ts';

const DROID_TYPE = 'ovrdroid-scope-leak-probe';
const TURN_REPLY = /⛬\s+ok/u;
const EXIT_POLL_MS = 250;
const LOG_FLUSH_MS = 1500;
const CHILD_COMMAND = 'echo scope-leak';
const CHILD_MODEL = 'stub-stream';
const CHAT_MODEL = 'stub-chat';

export const DEFAULT_HOLD_S = 45;
export const DEFAULT_SCOPE_RUNS = 3;
export const DEFAULT_SCOPE_TIMEOUT_S = 60;

export const DEFAULT_LINGER_S = 0;

export interface ScopeLeakOptions {
  cwd: string;
  hold: number;
  linger: number;
  timeout: number;
}

interface Stub {
  url: string;
  release: () => void;
  stop: () => Promise<void>;
}

function launchInput() {
  return {
    subagent_type: DROID_TYPE,
    description: `${DROID_TYPE} kept`,
    prompt: `${HOLD_WORD}kept`,
    run_in_background: true,
  };
}

function eventsFor(turn: StubTurn, runId: string): string[] {
  if (turn === 'launch') {
    return toolEvents({ id: `toolu_scope${runId}`, name: 'Task', input: launchInput() });
  }
  if (turn === 'child-work') {
    return toolEvents({
      id: `toolu_work${runId}`,
      name: 'Execute',
      input: { command: CHILD_COMMAND, riskLevel: 'low', summary: 'Print a word' },
    });
  }
  return streamEvents([turn === 'child' ? 'hi' : 'ok']);
}

interface ChatDelta {
  role?: 'assistant';
  content?: string;
  tool_calls?: readonly ChatToolCall[];
}

interface ChatToolCall {
  index: number;
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
}

function chunk(delta: ChatDelta, finish: string | null = null): string {
  return `data: ${JSON.stringify({ id: 'chatcmpl_stub', object: 'chat.completion.chunk', model: CHAT_MODEL, choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`;
}

function chatEventsFor(turn: MainTurn, runId: string): string {
  const usage = `data: ${JSON.stringify({ id: 'chatcmpl_stub', object: 'chat.completion.chunk', model: CHAT_MODEL, choices: [], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } })}\n\n`;
  const body =
    turn === 'launch'
      ? chunk({
          role: 'assistant',
          tool_calls: [
            {
              index: 0,
              id: `call_scope${runId}`,
              type: 'function',
              function: { name: 'Task', arguments: JSON.stringify(launchInput()) },
            },
          ],
        }) + chunk({}, 'tool_calls')
      : chunk({ role: 'assistant', content: 'ok' }) + chunk({}, 'stop');
  return `${body}${usage}data: [DONE]\n\n`;
}

function startScopeStub(runId: string, holdMs: number, lingerMs: number): Stub {
  const held = Promise.withResolvers<boolean>();
  const stopping = new AbortController();
  const holdNotice = async () => {
    await delay(holdMs, undefined, { signal: stopping.signal }).catch(() => null);
  };
  const server = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    idleTimeout: 0,
    async fetch(request) {
      const { pathname } = new URL(request.url);
      if (request.method === 'POST' && pathname.endsWith('/chat/completions')) {
        const turn = mainTurnFor(await request.json());
        if (turn === 'notice') {
          await holdNotice();
        }
        return new Response(chatEventsFor(turn, runId), {
          headers: { 'content-type': 'text/event-stream' },
        });
      }
      if (request.method !== 'POST' || !pathname.endsWith('/messages')) {
        return new Response('not found', { status: 404 });
      }
      const turn = turnFor(await request.json());
      if (turn === 'child') {
        await held.promise;
        await delay(lingerMs, undefined, { signal: stopping.signal }).catch(() => null);
      }
      if (turn === 'notice') {
        await holdNotice();
      }
      const events = eventsFor(turn, runId);
      return new Response(events.join(''), { headers: { 'content-type': 'text/event-stream' } });
    },
  });
  return {
    url: `http://127.0.0.1:${server.port}`,
    release: () => {
      held.resolve(true);
    },
    stop: async () => {
      held.resolve(true);
      stopping.abort();
      await server.stop(true);
    },
  };
}

function childDroidText(): string {
  return `---\nname: ${DROID_TYPE}\ndescription: Says hi for a probe.\nmodel: custom:${CHILD_MODEL}\n---\nSay hi.\n`;
}

function leakSettings(url: string) {
  const settings = stubSettings(url, CHILD_MODEL);
  const main = `custom:${CHAT_MODEL}`;
  return {
    ...settings,
    customModels: [
      ...settings.customModels,
      {
        id: main,
        model: CHAT_MODEL,
        displayName: 'Stub Chat',
        provider: 'generic-chat-completion-api',
        baseUrl: `${url}/v1`,
        apiKey: 'stub',
        maxOutputTokens: 8000,
        noImageSupport: true,
      },
    ],
    sessionDefaultSettings: { ...settings.sessionDefaultSettings, model: main },
  };
}

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function watchUntil(pid: number, ms: number): Promise<boolean> {
  const deadline = performance.now() + ms;
  while (performance.now() < deadline) {
    if (!alive(pid)) {
      return true;
    }
    // oxlint-disable-next-line no-await-in-loop
    await delay(EXIT_POLL_MS);
  }
  return !alive(pid);
}

async function logSince(start: number): Promise<string> {
  const size = logSize(LOG_PATH);
  return await logSlice(LOG_PATH, size < start ? 0 : start);
}

interface Drive {
  session: Session;
  stub: Stub;
  options: ScopeLeakOptions;
}

async function driveLeak({ session, stub, options }: Drive): Promise<boolean> {
  await send(session, `${LAUNCH_WORD} kept`);
  await waitFor(
    'the turn that launched the sub-agent never ended',
    () => (session.screen().some((line) => TURN_REPLY.test(line)) ? true : undefined),
    options.timeout * MS_PER_SECOND,
  );
  await settle(session);
  stub.release();
  return await watchUntil(session.pid, (options.hold + options.timeout) * MS_PER_SECOND);
}

export async function runScopeLeak(
  binary: string,
  options: ScopeLeakOptions,
): Promise<ScopeLeakRun> {
  const stub = startScopeStub(
    Date.now().toString(36),
    options.hold * MS_PER_SECOND,
    options.linger * MS_PER_SECOND,
  );
  const dir = makeTempDir('scope-leak');
  const droidFile = droidFilePath(DROID_TYPE);
  try {
    mkdirSync(FACTORY_DROIDS, { recursive: true });
    writeFileSync(droidFile, childDroidText());
    const settingsFile = path.join(dir, 'settings.json');
    writeFileSync(settingsFile, JSON.stringify(leakSettings(stub.url)));
    const start = logSize(LOG_PATH);
    const { session } = await openSettledSession(binary, {
      cwd: options.cwd,
      env: { FACTORY_RUNTIME_SETTINGS_PATH: settingsFile },
      screen: true,
    });
    try {
      const exited = await driveLeak({ session, stub, options });
      await delay(LOG_FLUSH_MS);
      return { binary, exited, events: logEvents(await logSince(start), session.pid) };
    } finally {
      await session.close();
    }
  } finally {
    await stub.stop();
    rmSync(dir, { recursive: true, force: true });
    rmSync(droidFile, { force: true });
  }
}
