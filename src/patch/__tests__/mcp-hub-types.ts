export interface Tool {
  name: string;
}

export interface ServerConfig {
  type: string;
  command?: string;
  args?: string[];
  url?: string;
}

export type Configs = Record<string, ServerConfig>;

export interface TextContent {
  type: string;
  text: string;
}

export interface ToolResult {
  content: TextContent[];
}

export interface Resource {
  uri: string;
  text?: string;
}

export interface Transport {
  pid?: number;
  close: () => Promise<void>;
}

export interface ServerRecord {
  name: string;
  config: ServerConfig;
  transport: Transport;
  pid?: number | null;
}

export interface Reap {
  kind: string;
  pid: number;
}

export type SpoolSource = (spool: { append: (entry: Reap) => void }) => void;

export interface Listing {
  client: FakeClient;
  tools: Tool[];
  callDefinitions: Map<string, Tool>;
  uncompilableOutputSchemas: string[];
}

export type CacheEntry =
  | { state: 'ready'; list: { tools: Tool[] } }
  | { state: 'loading' }
  | { state: 'failed' };

export type Subscriptions = Record<string, Set<string>>;

export interface Hub {
  servers: Record<string, ServerRecord>;
  toolsListCache: Map<string, CacheEntry>;
  clientResourceSubscriptions: Record<string, Subscriptions>;
  killServerProcessTree: (pid: number, name: string) => Promise<void>;
  openPendingConnection: (name: string, config: ServerConfig) => void;
  addServer: (name: string, config: ServerConfig) => Promise<void>;
  removeServer: (name: string) => Promise<void>;
  retryServer: (name: string) => Promise<void>;
  restartStdioServers: () => Promise<string[]>;
  listToolsForServer: (name: string) => Promise<{ tools: Tool[] }>;
  applyToolConfig: (name: string, tools: Tool[]) => Tool[];
  persistCatalog: () => void;
  discardCatalog: () => void;
  protocolEraFor: () => void;
  logInvalidToolsTransition: () => void;
  logUncompilableOutputSchemasTransition: () => void;
  callTool: (name: string, tool: string) => Promise<ToolResult>;
  readResource: (name: string, uri: string) => Promise<Resource>;
  subscribeToServerResource: (name: string, uri: string) => Promise<void>;
  unsubscribeFromServerResource: (name: string, uri: string) => Promise<void>;
  listResourcesForServer: (name: string) => Promise<Resource[]>;
  listResourceTemplatesForServer: (name: string) => Promise<Resource[]>;
}

export interface HubOptions {
  userMcpConfigs: Configs;
  logger: Logger;
  onToolsListChanged: (name: string) => Promise<void>;
}

export type HubClass = new (options: HubOptions) => Hub;

export interface Logger {
  info: () => void;
  warn: () => void;
  error: () => void;
  debug: () => void;
  child: () => Logger;
}

export interface Connection {
  client: FakeClient;
  transport: Transport;
}

export interface FakeClient {
  transport: object;
  listTools: () => Promise<{ tools: Tool[] }>;
  callTool: (request: Tool) => Promise<ToolResult>;
  readResource: (request: Resource) => Promise<{ contents: Resource[] }>;
  subscribeResource: () => Promise<void>;
  unsubscribeResource: () => Promise<void>;
  request: (request: {
    method: string;
  }) => Promise<{ resources: Resource[] } | { resourceTemplates: Resource[] }>;
  getServerVersion: () => { name: string; version: string };
  getNegotiatedProtocolVersion: () => string;
  getProtocolEra: () => 'legacy' | 'modern';
  getServerCapabilities: () => object;
  setNotificationHandler: () => void;
}
