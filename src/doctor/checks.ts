import path from 'node:path';

export interface Footgun {
  id: string;
  server: string;
  problem: string;
  impact: string;
  fix: string;
  fixHint?: string;
}

const WRAPPERS = new Set(['npx', 'npm', 'bunx', 'pnpm', 'yarn']);

export function wrapperBaseOf(command: string): string {
  return path
    .basename(command.trim())
    .replace(/\.cmd$/u, '')
    .toLowerCase();
}

export function isWrapperCommand(command: unknown): command is string {
  return typeof command === 'string' && WRAPPERS.has(wrapperBaseOf(command));
}

export interface McpServerEntry {
  command?: unknown;
  args?: readonly unknown[];
  disabled?: unknown;
}

export interface McpConfig {
  mcpServers: Record<string, McpServerEntry>;
}

export function isMcpConfig(value: unknown): value is McpConfig {
  if (typeof value !== 'object' || value === null || !('mcpServers' in value)) {
    return false;
  }
  const servers: unknown = value.mcpServers;
  if (typeof servers !== 'object' || servers === null) {
    return false;
  }
  return Object.values(servers).every((entry) => typeof entry === 'object' && entry !== null);
}

export type McpScope = 'user' | 'project';

const FIX_TEXT: Record<McpScope, string> = {
  user: 'run the server file itself: {"command": "node", "args": ["<path to the server>.js", ...]}',
  project:
    "run the package from the project's own node_modules; if it is not a dependency of the project, add it as a devDependency first",
};

export function checkMcpConfig(raw: unknown, scope: McpScope): readonly Footgun[] {
  if (!isMcpConfig(raw)) {
    return [];
  }
  const found: Footgun[] = [];
  for (const [server, entry] of Object.entries(raw.mcpServers)) {
    if (entry.disabled === true) {
      continue;
    }
    const command: unknown = entry.command;
    if (!isWrapperCommand(command)) {
      continue;
    }
    const base = wrapperBaseOf(command);
    const footgun: Footgun = {
      id: 'npm-exec-wrapper',
      server,
      problem: `"${server}" starts through ${base} instead of running the server directly`,
      impact: `every new session waits for ${base} to check the registry before the server starts, about 0.5 to 1.5s per server, and keeps an extra idle process of about 77MB`,
      fix: FIX_TEXT[scope],
    };
    if (base === 'npm' || base === 'npx') {
      footgun.fixHint = 'ovrdroid doctor --fix';
    }
    found.push(footgun);
  }
  return found;
}
