import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

import { MS_PER_SECOND, say } from '../cli.ts';
import type { McpConfig, McpServerEntry } from '../doctor/checks.ts';
import { readMcpConfig } from '../doctor/read.ts';
import type { LaunchEnv } from './launch.ts';
import {
  FIXTURE_NAME,
  FIXTURE_REPLY,
  FIXTURE_TOOL,
  fixtureCatalogs,
  forgetFixtureCatalogs,
  forgetFixtureTools,
  withFixtureDir,
  writeFixture,
} from './mcp-fixture.ts';
import type { AwakeCheck, ToolTurnResult } from './mcp-tool-turn.ts';
import { execToolTurn, interactiveTurn } from './mcp-tool-turn.ts';
import { stdoutOf } from './run.ts';
import type { Session } from './session.ts';
import { openSettledSession } from './session.ts';
import type { Parented } from './tree.ts';
import { descendants, parseParents } from './tree.ts';

export const DEFAULT_SETTLE_S = 5;

export interface StdioServer {
  name: string;
  signature: string;
}

export interface ServerReading {
  name: string;
  pid: number | undefined;
  processes: number;
}

export interface McpChildrenOptions {
  settle: number;
  env: LaunchEnv;
  servers: readonly StdioServer[];
  cwd: string;
  ask?: (session: Session) => Promise<void>;
  afterFirst?: () => void;
}

function isRemote(entry: McpServerEntry): boolean {
  return entry.type === 'http' || entry.type === 'sse';
}

function signatureOf(entry: McpServerEntry): string | undefined {
  const named = (entry.args ?? []).find(
    (arg): arg is string => typeof arg === 'string' && arg !== '' && !arg.startsWith('-'),
  );
  if (named !== undefined) {
    return named;
  }
  return typeof entry.command === 'string' ? path.basename(entry.command) : undefined;
}

export function stdioServers(config: McpConfig): StdioServer[] {
  const servers: StdioServer[] = [];
  for (const [name, entry] of Object.entries(config.mcpServers)) {
    const signature = signatureOf(entry);
    if (entry.disabled !== true && !isRemote(entry) && signature !== undefined) {
      servers.push({ name, signature });
    }
  }
  return servers;
}

export function readMcpChildren(
  rows: readonly Parented[],
  root: number,
  servers: readonly StdioServer[],
): ServerReading[] {
  const tree = new Set(descendants(rows, root));
  tree.delete(root);
  const inTree = rows.filter((row) => tree.has(row.pid));

  return servers.map((server) => {
    const matched = new Set(
      inTree.filter((row) => row.command.includes(server.signature)).map((row) => row.pid),
    );
    const top = inTree.find((row) => matched.has(row.pid) && !matched.has(row.ppid));
    return {
      name: server.name,
      pid: top?.pid,
      processes: top === undefined ? 0 : descendants(rows, top.pid).length,
    };
  });
}

export function runningServers(readings: readonly ServerReading[]): ServerReading[] {
  return readings.filter((reading) => reading.pid !== undefined);
}

export function describeMcpChildren(readings: readonly ServerReading[]): string {
  if (readings.length === 0) {
    return 'nothing to test: no stdio MCP servers configured';
  }
  return readings
    .map((reading) => {
      if (reading.pid === undefined) {
        return `${reading.name}: not running (dormant)`;
      }
      const extra = reading.processes > 1 ? `, ${reading.processes} processes in its tree` : '';
      return `${reading.name}: running, pid ${reading.pid}${extra}`;
    })
    .join('\n');
}

export interface McpLaunches {
  first: readonly ServerReading[];
  second: readonly ServerReading[];
}

export interface McpVerdict {
  pass: boolean;
  reason: string;
}

function names(readings: readonly ServerReading[]): string {
  return readings.map((reading) => reading.name).join(', ');
}

export type Mode = 'interactive' | 'exec';

export interface ModeReading extends ToolTurnResult {
  mode: Mode;
}

function toolTurnFailure(turn: ModeReading, dormant: boolean): string | undefined {
  const { mode, reading } = turn;
  if (reading.requests === 0) {
    return `${mode}: the model was never sent a request, so nothing was tested`;
  }
  if (reading.offered === undefined) {
    return `${mode}: the model was not offered ${FIXTURE_NAME}'s tools${dormant ? ' while the server was dormant' : ''}`;
  }
  if (!reading.ponged) {
    return `${mode}: calling ${FIXTURE_TOOL} did not return ${FIXTURE_REPLY}`;
  }
  return undefined;
}

export function judgeMcpChildren(
  launches: McpLaunches,
  mustStartCold: boolean,
  turns: readonly ModeReading[] = [],
): McpVerdict {
  if (launches.second.length === 0) {
    return { pass: false, reason: 'nothing tested: no stdio MCP servers to look for' };
  }
  const neverStarted = launches.first.filter((reading) => reading.pid === undefined);
  if (mustStartCold && neverStarted.length > 0) {
    return {
      pass: false,
      reason: `nothing tested: Droid never started ${names(neverStarted)} on the first launch, so it did not load the fixture config`,
    };
  }
  const running = runningServers(launches.second);
  const failures: string[] = [];
  if (running.length > 0) {
    failures.push(`kept running from launch: ${names(running)}`);
  }
  for (const turn of turns) {
    const failure = toolTurnFailure(turn, running.length === 0);
    if (failure !== undefined) {
      failures.push(failure);
    }
  }
  if (failures.length > 0) {
    return { pass: false, reason: failures.join('\n') };
  }
  const dormant = 'every stdio server stayed dormant on the second launch';
  if (turns.length === 0) {
    return { pass: true, reason: dormant };
  }
  const modes = turns.map((turn) => turn.mode).join(' and ');
  return {
    pass: true,
    reason: `${dormant}, and the model was offered ${FIXTURE_NAME}'s tools and got ${FIXTURE_REPLY} back in ${modes}`,
  };
}

function indent(text: string): string {
  return text
    .split('\n')
    .map((line) => `  ${line}`)
    .join('\n');
}

export function describeLaunches(launches: McpLaunches): string {
  return [
    'first launch, tools not cached yet:',
    indent(describeMcpChildren(launches.first)),
    'second launch, the one judged:',
    indent(describeMcpChildren(launches.second)),
  ].join('\n');
}

const OFFERS = {
  tool: 'offered as a tool',
  deferred: 'listed in the deferred tools',
} as const;

function describeTurn({ mode, reading, awake }: ModeReading): string {
  const offered = reading.offered === undefined ? 'not offered' : OFFERS[reading.offered];
  const answer = reading.ponged ? `${FIXTURE_REPLY} came back` : `no ${FIXTURE_REPLY}`;
  const woke = (() => {
    if (awake === undefined) {
      return 'no tool result reached the model';
    }
    return awake
      ? 'server running when the result came back (woke)'
      : 'server not running when the result came back';
  })();
  return `${mode}: ${FIXTURE_TOOL} ${offered}, ${answer}, ${woke}`;
}

export function describeToolTurns(turns: readonly ModeReading[]): string {
  return [
    'one model turn per mode, against the cached tools:',
    ...turns.map((turn) => describeTurn(turn)),
  ]
    .map((line, at) => (at === 0 ? line : indent(line)))
    .join('\n');
}

export function envPair(raw: string, previous: LaunchEnv = {}): LaunchEnv {
  const at = raw.indexOf('=');
  if (at < 1) {
    throw new TypeError(`expected KEY=VALUE, got "${raw}"`);
  }
  return { ...previous, [raw.slice(0, at)]: raw.slice(at + 1) };
}

async function readServers(
  root: number,
  servers: readonly StdioServer[],
): Promise<ServerReading[]> {
  const listing = await stdoutOf(['ps', '-Ao', 'pid,ppid,command']);
  return readMcpChildren(parseParents(listing), root, servers);
}

function awakeCheck(servers: readonly StdioServer[]): AwakeCheck {
  return async (root) => runningServers(await readServers(root, servers)).length > 0;
}

async function readOneLaunch(
  binary: string,
  options: McpChildrenOptions,
  ask?: (session: Session) => Promise<void>,
): Promise<ServerReading[]> {
  const { session } = await openSettledSession(binary, {
    env: options.env,
    cwd: options.cwd,
    collect: false,
  });
  try {
    await delay(options.settle * MS_PER_SECOND);
    const readings = await readServers(session.pid, options.servers);
    await ask?.(session);
    return readings;
  } finally {
    await session.close();
  }
}

export async function countMcpChildren(
  binary: string,
  options: McpChildrenOptions,
): Promise<McpLaunches> {
  const first = await readOneLaunch(binary, options);
  options.afterFirst?.();
  const second = await readOneLaunch(binary, options, options.ask);
  return { first, second };
}

export interface McpChildrenCommandOptions {
  settle: number;
  env: LaunchEnv;
  mcp?: string;
}

interface McpRun {
  servers: readonly StdioServer[];
  cwd: string;
  mustStartCold: boolean;
}

async function judgedLaunches(
  binary: string,
  options: McpChildrenCommandOptions,
  run: McpRun,
): Promise<McpVerdict> {
  const launches = await countMcpChildren(binary, {
    settle: options.settle,
    env: options.env,
    servers: run.servers,
    cwd: run.cwd,
  });
  say(describeLaunches(launches));
  return judgeMcpChildren(launches, run.mustStartCold);
}

async function judgedFixture(
  binary: string,
  options: McpChildrenCommandOptions,
  run: McpRun,
): Promise<McpVerdict> {
  const { servers, cwd } = run;
  const isAwake = awakeCheck(servers);
  const interactive = interactiveTurn(cwd, isAwake);
  const known = fixtureCatalogs();
  const forgetCatalogs = () => {
    forgetFixtureCatalogs(known);
  };
  try {
    const launches = await countMcpChildren(binary, {
      settle: options.settle,
      env: { ...options.env, ...interactive.env },
      servers,
      cwd,
      ask: interactive.ask,
      afterFirst: forgetCatalogs,
    });
    say(describeLaunches(launches));
    forgetCatalogs();
    const exec = await execToolTurn(binary, { dir: cwd, isAwake, env: options.env });
    const turns: ModeReading[] = [
      { mode: 'interactive', ...interactive.result() },
      { mode: 'exec', ...exec },
    ];
    say(describeToolTurns(turns));
    return judgeMcpChildren(launches, run.mustStartCold, turns);
  } finally {
    forgetCatalogs();
    await interactive.stop();
  }
}

export async function runMcpChildren(
  binary: string,
  options: McpChildrenCommandOptions,
): Promise<McpVerdict> {
  say(
    `launching twice, waiting ${options.settle}s after the input box each time; a server counts as running while a process under this droid carries its package name or command`,
  );
  if (options.mcp !== undefined) {
    return await judgedLaunches(binary, options, {
      servers: stdioServers(readMcpConfig(options.mcp)),
      cwd: process.cwd(),
      mustStartCold: false,
    });
  }
  say(
    `then one model turn from a local stub in the second launch and one in droid exec, each calling ${FIXTURE_TOOL} on the fixture`,
  );
  return await withFixtureDir(async (dir) => {
    const config = writeFixture(dir, process.execPath);
    say(`fixture server ${FIXTURE_NAME} in ${path.join(dir, '.factory', 'mcp.json')}`);
    try {
      return await judgedFixture(binary, options, {
        servers: stdioServers(config),
        cwd: dir,
        mustStartCold: true,
      });
    } finally {
      forgetFixtureTools(config);
    }
  });
}
