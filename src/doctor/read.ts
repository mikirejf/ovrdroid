import { readFileSync } from 'node:fs';

import type { McpConfig } from './checks.ts';
import { isMcpConfig } from './checks.ts';

export interface PackageManifest {
  version?: unknown;
  bin?: unknown;
  workspaces?: unknown;
}

function parse(file: string): object {
  const parsed: unknown = JSON.parse(readFileSync(file, 'utf-8'));
  if (typeof parsed !== 'object' || parsed === null) {
    throw new TypeError(`${file} is not a JSON object`);
  }
  return parsed;
}

export function readMcpConfig(file: string): McpConfig {
  const parsed = parse(file);
  if (!isMcpConfig(parsed)) {
    throw new TypeError(`${file} is not an mcp.json with mcpServers`);
  }
  return parsed;
}

export function readManifest(file: string): PackageManifest {
  return parse(file);
}
