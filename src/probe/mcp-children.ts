import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

import { MS_PER_SECOND, say } from '../cli.ts';
import type { McpConfig, McpServerEntry } from '../doctor/checks.ts';
import { readMcpConfig } from '../doctor/read.ts';
import type { LaunchEnv } from './launch.ts';
import { FIXTURE_NAME, forgetFixtureTools, withFixtureDir, writeFixture } from './mcp-fixture.ts';
import { stdoutOf } from './run.ts';
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

export function judgeMcpChildren(launches: McpLaunches, mustStartCold: boolean): McpVerdict {
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
  if (running.length > 0) {
    return { pass: false, reason: `kept running from launch: ${names(running)}` };
  }
  return { pass: true, reason: 'every stdio server stayed dormant on the second launch' };
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

export function envPair(raw: string, previous: LaunchEnv = {}): LaunchEnv {
  const at = raw.indexOf('=');
  if (at < 1) {
    throw new TypeError(`expected KEY=VALUE, got "${raw}"`);
  }
  return { ...previous, [raw.slice(0, at)]: raw.slice(at + 1) };
}

async function readOneLaunch(
  binary: string,
  options: McpChildrenOptions,
): Promise<ServerReading[]> {
  const { session } = await openSettledSession(binary, {
    env: options.env,
    cwd: options.cwd,
    collect: false,
  });
  try {
    await delay(options.settle * MS_PER_SECOND);
    const listing = await stdoutOf(['ps', '-Ao', 'pid,ppid,command']);
    return readMcpChildren(parseParents(listing), session.pid, options.servers);
  } finally {
    await session.close();
  }
}

export async function countMcpChildren(
  binary: string,
  options: McpChildrenOptions,
): Promise<McpLaunches> {
  const first = await readOneLaunch(binary, options);
  const second = await readOneLaunch(binary, options);
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
  return await withFixtureDir(async (dir) => {
    const config = writeFixture(dir, process.execPath);
    say(`fixture server ${FIXTURE_NAME} in ${path.join(dir, '.factory', 'mcp.json')}`);
    try {
      return await judgedLaunches(binary, options, {
        servers: stdioServers(config),
        cwd: dir,
        mustStartCold: true,
      });
    } finally {
      forgetFixtureTools(config);
    }
  });
}
