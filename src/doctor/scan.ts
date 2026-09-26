import type { Footgun, McpScope } from './checks.ts';
import { checkMcpConfig } from './checks.ts';
import { readMcpConfig } from './read.ts';

export function scanMcpConfig(mcpPath: string, scope: McpScope): readonly Footgun[] {
  try {
    return checkMcpConfig(readMcpConfig(mcpPath), scope);
  } catch {
    return [];
  }
}
