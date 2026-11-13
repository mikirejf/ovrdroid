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
}

export interface Listing {
  client: FakeClient;
  tools: Tool[];
  callDefinitions: Map<string, Tool>;
  uncompilableOutputSchemas: string[];
}

export interface ToolListingResult {
  tools: Tool[];
  seeded?: boolean;
  list?: object;
}

export interface PreparedInvocation {
  serverName: string;
  tool: Tool;
  callDefinition: Tool;
  client: FakeClient;
  preparationElapsedMs: number;
  isCurrent: () => boolean;
}

export type CacheEntry =
  | { state: 'ready'; list: { tools: Tool[] } }
  | { state: 'loading' }
  | { state: 'failed' };

export type Subscriptions = Record<string, Set<string>>;

export interface Hub {
  servers: Record<string, ServerRecord>;
  seeds: Map<string, { tools: Tool[] }>;
  toolsListCache: Map<string, CacheEntry>;
  clientResourceSubscriptions: Record<string, Subscriptions>;
  openPendingConnection: (name: string, config: ServerConfig) => void;
  addServer: (name: string, config: ServerConfig) => Promise<void>;
  removeServer: (name: string) => Promise<void>;
  retryServer: (name: string) => Promise<void>;
  restartStdioServers: () => Promise<string[]>;
  listToolsForServer: (name: string) => Promise<ToolListingResult>;
  isToolListingCurrent: (name: string, result: ToolListingResult) => boolean;
  applyToolConfig: (name: string, tools: Tool[]) => Tool[];
  persistCatalog: () => void;
  discardCatalog: () => void;
  protocolEraFor: () => void;
  logInvalidToolsTransition: () => void;
  logUncompilableOutputSchemasTransition: () => void;
  bindsInvocationAtAdmission: (name: string) => Promise<boolean>;
  prepareToolInvocation: (name: string, tool: string) => Promise<PreparedInvocation>;
  getExpiredToolCatalogServers: () => string[];
  callTool: (
    ...args: [
      name: string,
      tool: string,
      input?: Record<string, never>,
      sessionId?: string,
      caller?: string,
      signal?: AbortSignal,
      prepared?: PreparedInvocation,
      onDispatched?: () => void,
    ]
  ) => Promise<ToolResult>;
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
  callTool: (request: Tool, options?: { beforeSend?: () => void }) => Promise<ToolResult>;
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
