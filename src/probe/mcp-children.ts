import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

import { MS_PER_SECOND } from '../cli.ts';
import type { McpConfig, McpServerEntry } from '../doctor/checks.ts';
import type { LaunchEnv } from './launch.ts';
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
  mcp: McpConfig;
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

export function describeMcpChildren(readings: readonly ServerReading[]): string {
  if (readings.length === 0) {
    return 'no stdio MCP servers are configured, so there is nothing to count';
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

export function envPair(raw: string, previous: LaunchEnv = {}): LaunchEnv {
  const at = raw.indexOf('=');
  if (at < 1) {
    throw new TypeError(`expected KEY=VALUE, got "${raw}"`);
  }
  return { ...previous, [raw.slice(0, at)]: raw.slice(at + 1) };
}

export async function countMcpChildren(
  binary: string,
  options: McpChildrenOptions,
): Promise<ServerReading[]> {
  const { session } = await openSettledSession(binary, { env: options.env, collect: false });
  try {
    await delay(options.settle * MS_PER_SECOND);
    const listing = await stdoutOf(['ps', '-Ao', 'pid,ppid,command']);
    return readMcpChildren(parseParents(listing), session.pid, stdioServers(options.mcp));
  } finally {
    await session.close();
  }
}
