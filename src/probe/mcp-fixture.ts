import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  realpathSync,
  rmdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { rm } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';

import type { McpConfig, McpServerEntry } from '../doctor/checks.ts';
import { MCP_TOOLS_KEY_LENGTH, MCP_TOOLS_UNDER_HOME } from '../patch/mcp-idle-patches.ts';
import { FACTORY_SESSIONS } from '../paths.ts';
import { sessionFolderName } from './ledger.ts';

const MCP_TOOLS = path.join(homedir(), ...MCP_TOOLS_UNDER_HOME.split('/'));

export const FIXTURE_NAME = 'ovrdroid-fixture';
export const FIXTURE_SCRIPT = 'ovrdroid-mcp-fixture.js';

const FIXTURE_SOURCE = `const tools = [{ name: 'ping', description: 'ovrdroid probe fixture', inputSchema: { type: 'object', properties: {} } }];
const send = (message) => process.stdout.write(JSON.stringify({ jsonrpc: '2.0', ...message }) + '\\n');
const answer = (message) => {
  switch (message.method) {
    case 'initialize':
      return { result: { protocolVersion: message.params?.protocolVersion ?? '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: '${FIXTURE_NAME}', version: '1.0.0' } } };
    case 'tools/list':
      return { result: { tools } };
    case 'tools/call':
      return { result: { content: [{ type: 'text', text: 'pong' }] } };
    case 'ping':
      return { result: {} };
    default:
      return { error: { code: -32601, message: 'Method not found' } };
  }
};
let pending = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => {
  pending += chunk;
  for (let end = pending.indexOf('\\n'); end !== -1; end = pending.indexOf('\\n')) {
    const line = pending.slice(0, end).trim();
    pending = pending.slice(end + 1);
    let message;
    try {
      message = JSON.parse(line);
    } catch {
      continue;
    }
    if (message.id !== undefined && typeof message.method === 'string') {
      send({ id: message.id, ...answer(message) });
    }
  }
});
process.stdin.on('end', () => process.exit(0));
`;

export function fixtureConfig(dir: string, runtime: string): McpConfig {
  return {
    mcpServers: { [FIXTURE_NAME]: { command: runtime, args: [path.join(dir, FIXTURE_SCRIPT)] } },
  };
}

export function writeFixture(dir: string, runtime: string): McpConfig {
  const config = fixtureConfig(dir, runtime);
  writeFileSync(path.join(dir, FIXTURE_SCRIPT), FIXTURE_SOURCE);
  mkdirSync(path.join(dir, '.factory'), { recursive: true });
  writeFileSync(path.join(dir, '.factory', 'mcp.json'), JSON.stringify(config, null, 2));
  return config;
}

export function toolsCacheName(name: string, entry: McpServerEntry): string {
  const key = createHash('sha256')
    .update(`${name}\0${JSON.stringify(entry)}`)
    .digest('hex');
  return `${key.slice(0, MCP_TOOLS_KEY_LENGTH)}.json`;
}

export function forgetFixtureTools(config: McpConfig): void {
  for (const [name, entry] of Object.entries(config.mcpServers)) {
    rmSync(path.join(MCP_TOOLS, toolsCacheName(name, entry)), { force: true });
  }
}

function removeIfEmpty(folder: string): void {
  if (existsSync(folder) && readdirSync(folder).length === 0) {
    rmdirSync(folder);
  }
}

export async function withFixtureDir<T>(use: (dir: string) => Promise<T>): Promise<T> {
  const dir = realpathSync(mkdtempSync(path.join(process.cwd(), '.ovrdroid-mcp-fixture-')));
  try {
    return await use(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
    removeIfEmpty(path.join(FACTORY_SESSIONS, sessionFolderName(dir)));
  }
}
