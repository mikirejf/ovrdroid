import { writeFileSync } from 'node:fs';
import path from 'node:path';

import { MS_PER_SECOND } from '../cli.ts';
import type { Fields } from './fields.ts';
import { entriesOf, fieldsOf, worded } from './fields.ts';
import { launchEnv, race } from './launch.ts';
import type { LaunchEnv } from './launch.ts';
import { FIXTURE_NAME, FIXTURE_REPLY, FIXTURE_TOOL, FIXTURE_TOOL_NAME } from './mcp-fixture.ts';
import { Ledger } from './owned-sessions.ts';
import { ENTER } from './session.ts';
import type { Session } from './session.ts';
import { toolNamesIn, toolResultsIn } from './stale-edit-cases.ts';
import type { StubCall, ToolResult } from './stale-edit-cases.ts';
import { streamEvents, stubSettings, toolEvents } from './stub-model.ts';

const SEARCH_TOOL = 'ToolSearch';
const SEARCH_ID = 'toolu_mcp_search';
const CALL_ID = 'toolu_mcp_call';
const STUB_MODEL = 'stub-mcp-tool';
const PROMPT = 'ping';
const TURN_TIMEOUT_S = 60;

export type Offer = 'tool' | 'deferred';

export const OFFER_WORDS = {
  tool: 'offered as a tool',
  deferred: 'listed in the deferred tools',
} as const;

export interface Scope {
  marker: string;
  tag: string;
}

export interface ToolTurnReading {
  requests: number;
  offered: Offer | undefined;
  ponged: boolean;
}

export interface ToolTurnResult {
  reading: ToolTurnReading;
  awake: boolean | undefined;
}

export type AwakeCheck = (root: number) => Promise<boolean>;

export interface ToolUse {
  id: string;
  name: string;
}

function messagesOf(body: unknown): Fields[] {
  return entriesOf(fieldsOf(body), 'messages');
}

function usesIn(messages: readonly Fields[]): ToolUse[] {
  return messages
    .filter((message) => worded(message, 'role') === 'assistant')
    .flatMap((message) => entriesOf(message, 'content'))
    .filter((block) => worded(block, 'type') === 'tool_use')
    .map((block) => ({ id: worded(block, 'id'), name: worded(block, 'name') }));
}

export function toolUsesIn(body: unknown): ToolUse[] {
  return usesIn(messagesOf(body));
}

function userTextLines(body: unknown): string[] {
  return entriesOf(fieldsOf(body), 'messages')
    .filter((message) => worded(message, 'role') === 'user')
    .flatMap((message) => entriesOf(message, 'content'))
    .filter((block) => worded(block, 'type') === 'text')
    .flatMap((block) => worded(block, 'text').split('\n'))
    .map((line) => line.trim());
}

export function textsOf(message: Fields): string[] {
  const content = message.get('content');
  if (typeof content === 'string') {
    return [content];
  }
  return entriesOf(message, 'content')
    .filter((block) => worded(block, 'type') === 'text')
    .map((block) => worded(block, 'text'));
}

function sinceMarker(messages: readonly Fields[], marker: string): Fields[] {
  const at = messages.findLastIndex(
    (message) =>
      worded(message, 'role') === 'user' && textsOf(message).some((text) => text.includes(marker)),
  );
  return messages.slice(Math.max(at, 0));
}

export function toolUsesSince(body: unknown, marker: string): ToolUse[] {
  return usesIn(sinceMarker(messagesOf(body), marker));
}

export function usedToolSince(body: unknown, toolName: string, marker: string): boolean {
  return toolUsesSince(body, marker).some((use) => use.name === toolName);
}

export function offerOf(body: unknown, toolName: string): Offer | undefined {
  if (toolNamesIn(body).includes(toolName)) {
    return 'tool';
  }
  return userTextLines(body).includes(toolName) ? 'deferred' : undefined;
}

export function resultOf(body: unknown, toolName: string): ToolResult | undefined {
  const ids = new Set(
    toolUsesIn(body)
      .filter((use) => use.name === toolName)
      .map((use) => use.id),
  );
  return [...toolResultsIn(body)].find(([id]) => ids.has(id))?.[1];
}

export function nextModelCall(
  body: unknown,
  toolName: string,
  scope?: Scope,
): StubCall | undefined {
  const messages = messagesOf(body);
  const uses = usesIn(scope === undefined ? messages : sinceMarker(messages, scope.marker));
  if (uses.some((use) => use.name === toolName)) {
    return undefined;
  }
  const offer = offerOf(body, toolName);
  const searched = uses.some((use) => use.name === SEARCH_TOOL);
  const suffix = scope === undefined ? '' : `_${scope.tag}`;
  if (offer === 'tool' || searched) {
    return { id: `${CALL_ID}${suffix}`, name: toolName, input: {} };
  }
  if (offer === 'deferred') {
    return {
      id: `${SEARCH_ID}${suffix}`,
      name: SEARCH_TOOL,
      input: { query: `select:${toolName}` },
    };
  }
  return undefined;
}

export function readingFailure(
  label: string,
  reading: ToolTurnReading,
  dormant: boolean,
): string | undefined {
  if (reading.requests === 0) {
    return `${label}: the model was never sent a request, so nothing was tested`;
  }
  if (reading.offered === undefined) {
    return `${label}: the model was not offered ${FIXTURE_NAME}'s tools${dormant ? ' while the server was dormant' : ''}`;
  }
  if (!reading.ponged) {
    return `${label}: calling ${FIXTURE_TOOL} did not return ${FIXTURE_REPLY}`;
  }
  return undefined;
}

export function readToolTurn(bodies: readonly unknown[], toolName: string): ToolTurnReading {
  const turns = bodies.filter((body) => toolNamesIn(body).length > 0);
  const [first] = turns;
  return {
    requests: turns.length,
    offered: first === undefined ? undefined : offerOf(first, toolName),
    ponged: turns.some((body) => {
      const result = resultOf(body, toolName);
      return result !== undefined && !result.isError && result.text.includes(FIXTURE_REPLY);
    }),
  };
}

interface ToolTurnServer {
  url: string;
  ended: Promise<boolean>;
  result: () => ToolTurnResult;
  stop: () => Promise<void>;
}

function eventStream(events: readonly string[]): Response {
  return new Response(events.join(''), { headers: { 'content-type': 'text/event-stream' } });
}

function serveToolTurns(
  toolName: string,
  root: Promise<number>,
  isAwake: AwakeCheck,
): ToolTurnServer {
  const bodies: unknown[] = [];
  const ended = Promise.withResolvers<boolean>();
  let awake: boolean | undefined;
  const server = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    async fetch(request) {
      if (request.method !== 'POST' || !new URL(request.url).pathname.endsWith('/messages')) {
        return new Response('not found', { status: 404 });
      }
      const body: unknown = await request.json();
      bodies.push(body);
      if (toolNamesIn(body).length === 0) {
        return eventStream(streamEvents(['ok']));
      }
      if (awake === undefined && resultOf(body, toolName) !== undefined) {
        awake = await isAwake(await root);
      }
      const call = nextModelCall(body, toolName);
      if (call === undefined) {
        ended.resolve(true);
        return eventStream(streamEvents(['done']));
      }
      return eventStream(toolEvents(call));
    },
  });
  return {
    url: `http://127.0.0.1:${server.port}`,
    ended: ended.promise,
    result: () => ({ reading: readToolTurn(bodies, toolName), awake }),
    stop: async () => {
      await server.stop(true);
    },
  };
}

export function writeStubSettings(dir: string, name: string, url: string): string {
  const file = path.join(dir, `settings-${name}.json`);
  writeFileSync(file, JSON.stringify(stubSettings(url, STUB_MODEL)));
  return file;
}

export interface InteractiveTurn {
  env: LaunchEnv;
  ask: (session: Session) => Promise<void>;
  result: () => ToolTurnResult;
  stop: () => Promise<void>;
}

export function interactiveTurn(dir: string, isAwake: AwakeCheck): InteractiveTurn {
  const root = Promise.withResolvers<number>();
  const server = serveToolTurns(FIXTURE_TOOL_NAME, root.promise, isAwake);
  return {
    env: { FACTORY_RUNTIME_SETTINGS_PATH: writeStubSettings(dir, 'interactive', server.url) },
    ask: async (session) => {
      root.resolve(session.pid);
      await session.type(PROMPT);
      await session.type(ENTER);
      await race(
        server.ended,
        TURN_TIMEOUT_S * MS_PER_SECOND,
        `the stub model was not done ${TURN_TIMEOUT_S}s after the prompt was sent`,
      );
    },
    result: server.result,
    stop: server.stop,
  };
}

export interface ExecTurnRun {
  dir: string;
  isAwake: AwakeCheck;
  env: LaunchEnv;
}

export async function execToolTurn(
  binary: string,
  { dir, isAwake, env }: ExecTurnRun,
): Promise<ToolTurnResult> {
  const root = Promise.withResolvers<number>();
  const server = serveToolTurns(FIXTURE_TOOL_NAME, root.promise, isAwake);
  const flags = path.join(dir, 'feature-flags.json');
  writeFileSync(flags, JSON.stringify({ flags: {}, configs: {} }));
  const settings = writeStubSettings(dir, 'exec', server.url);
  const ledger = new Ledger(dir);
  try {
    const child = Bun.spawn(
      [binary, 'exec', '--auto', 'high', '-m', `custom:${STUB_MODEL}`, '--cwd', dir, PROMPT],
      {
        stdin: 'ignore',
        stdout: 'ignore',
        stderr: 'ignore',
        env: launchEnv({
          ...env,
          FACTORY_RUNTIME_SETTINGS_PATH: settings,
          FACTORY_FEATURE_FLAGS_SNAPSHOT_PATH: flags,
          ...ledger.env,
        }),
      },
    );
    root.resolve(child.pid);
    ledger.adopt(child);
    ledger.expectSession();
    await race(
      child.exited,
      TURN_TIMEOUT_S * MS_PER_SECOND,
      `${binary} exec was still running ${TURN_TIMEOUT_S}s in`,
    );
    return server.result();
  } finally {
    await ledger.release();
    await server.stop();
  }
}
