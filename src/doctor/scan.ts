import { FACTORY_MCP } from '../paths.ts';
import type { Footgun } from './checks.ts';
import { checkMcpConfig } from './checks.ts';
import { readMcpConfig } from './read.ts';

export function scanMcpConfig(mcpPath: string = FACTORY_MCP): readonly Footgun[] {
  try {
    return checkMcpConfig(readMcpConfig(mcpPath));
  } catch {
    return [];
  }
}
