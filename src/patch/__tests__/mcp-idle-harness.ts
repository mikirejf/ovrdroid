import { createHash } from 'node:crypto';

import { patchSource } from '../../binary/apply.ts';
import { MCP_TOOLS_KEY_LENGTH, MCP_TOOLS_UNDER_HOME, mcpIdlePatches } from '../mcp-idle-patches.ts';
import { markerStatement } from '../patches.ts';
import { fakeFs } from './mcp-fake-fs.ts';
import { STOCK_HUB_MODULE, STOCK_PID_HELPERS } from './mcp-hub-stock.ts';
import { payloadFunction } from './payload.ts';

export const SERVER = 'chrome-devtools';
export const HOME = '/home/tester';
export const FIRST_PID = 4100;
const MINUTE = 60_000;

export interface Tool {
  name: string;
}

export interface ServerConfig {
  type: string;
  command?: string;
  args?: string[];
  url?: string;
}

type Configs = Record<string, ServerConfig>;

export const STDIO_CONFIG: ServerConfig = {
  type: 'stdio',
  command: 'npx',
  args: ['-y', 'chrome-devtools-mcp'],
};
export const HTTP_CONFIG: ServerConfig = { type: 'http', url: 'https://mcp.example.test/' };
export const TOOLS: Tool[] = [{ name: 'take_screenshot' }, { name: 'click' }];

interface TextContent {
  type: string;
  text: string;
}

interface ToolResult {
  content: TextContent[];
}

interface Resource {
  uri: string;
  text?: string;
}

interface Transport {
  pid?: number;
  close: () => Promise<void>;
}

interface ServerRecord {
  name: string;
  config: ServerConfig;
  transport: Transport;
}

type CacheEntry = { state: 'ready'; tools: Tool[] } | { state: 'loading' } | { state: 'failed' };

type Subscriptions = Record<string, Set<string>>;

interface Hub {
  servers: Record<string, ServerRecord>;
  toolsListCache: Map<string, CacheEntry>;
  clientResourceSubscriptions: Record<string, Subscriptions>;
  killServerProcessTree: (pid: number, name: string) => Promise<void>;
  openPendingConnection: (name: string) => void;
  addServer: (name: string, config: ServerConfig) => Promise<void>;
  removeServer: (name: string) => Promise<void>;
  retryServer: (name: string) => Promise<void>;
  restartStdioServers: () => Promise<string[]>;
  listToolsForServer: (name: string) => Promise<{ tools: Tool[] }>;
  applyToolConfig: (name: string, tools: Tool[]) => Tool[];
  persistCatalog: () => void;
  discardCatalog: () => void;
  callTool: (name: string, tool: string) => Promise<ToolResult>;
  readResource: (name: string, uri: string) => Promise<Resource>;
  subscribeToServerResource: (name: string, uri: string) => Promise<void>;
  unsubscribeFromServerResource: (name: string, uri: string) => Promise<void>;
  listResourcesForServer: (name: string) => Promise<Resource[]>;
  listResourceTemplatesForServer: (name: string) => Promise<Resource[]>;
}

interface HubOptions {
  userMcpConfigs: Configs;
  logger: Logger;
  onToolsListChanged: (name: string) => Promise<void>;
}

type HubClass = new (options: HubOptions) => Hub;

type HoldKind = 'spawn' | 'call' | 'close' | 'list';

export interface Timer {
  delay: number;
  active: boolean;
  callback: () => void;
  unref: () => void;
}

interface Logger {
  info: () => void;
  warn: () => void;
  error: () => void;
  debug: () => void;
  child: () => Logger;
}

type SpawnArgs = Pick<ServerConfig, 'command' | 'url'>;

interface Connection {
  client: FakeClient;
  transport: Transport;
}

interface FakeClient {
  listTools: () => Promise<{ tools: Tool[] }>;
  callTool: (request: Tool) => Promise<ToolResult>;
  readResource: (request: Resource) => Promise<{ contents: Resource[] }>;
  subscribeResource: () => Promise<void>;
  unsubscribeResource: () => Promise<void>;
  listResources: () => Promise<{ resources: Resource[] }>;
  listResourceTemplates: () => Promise<{ resourceTemplates: Resource[] }>;
  getServerVersion: () => { name: string; version: string };
  setNotificationHandler: () => void;
}

const PATCHED = patchSource([{ name: 'hub.js', text: STOCK_HUB_MODULE }], mcpIdlePatches)[0]
  .text.replace(markerStatement(mcpIdlePatches), '')
  .replace(STOCK_PID_HELPERS, '');

const BINDINGS =
  'G ur a ii ri Ut gi Yr ti Iy te Zr je vn z5 Py vy Sn S cee ut YB Dt hn dn fo Tee It ch Br require process setTimeout clearTimeout QH'.split(
    ' ',
  );

function bareRecord(): Configs {
  // SAFETY: the stock hub builds its maps with Object.create(null) and only ever stores into them.
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion
  return Object.create(null) as Configs;
}

function pidOf(transport: Transport): number | null {
  const { pid } = transport;
  return typeof pid === 'number' && pid > 0 ? pid : null;
}

function never(): never {
  throw new Error('unreachable in this harness');
}

function ignore(): void {}

export function cacheFileOf(name: string, config: ServerConfig): string {
  const key = createHash('sha256')
    .update(`${name}\0${JSON.stringify(config)}`)
    .digest('hex')
    .slice(0, MCP_TOOLS_KEY_LENGTH);
  return `${HOME}/${MCP_TOOLS_UNDER_HOME}/${key}.json`;
}

export class HubWorld {
  readonly hub: Hub;
  readonly files = new Map<string, string>();
  readonly timers: Timer[] = [];
  readonly spawned: SpawnArgs[] = [];
  readonly closed: number[] = [];
  readonly killed: number[] = [];
  readonly alive = new Set<number>();
  readonly changed: string[] = [];
  readonly calls: string[] = [];
  readonly env: Record<string, string> = {};
  tools: Tool[] = TOOLS;
  failSpawns = 0;
  exitOnClose = false;
  private readonly holds = new Map<HoldKind, Promise<boolean>>();
  private nextPid = FIRST_PID;

  constructor(configs?: Configs) {
    const logger: Logger = {
      info: ignore,
      warn: ignore,
      error: ignore,
      debug: ignore,
      child: () => logger,
    };
    const build = payloadFunction<unknown[], HubClass>(BINDINGS, `${PATCHED}return Ft`);
    const Hub = build(
      bareRecord,
      (value: Configs) => ({ ...value }),
      Error,
      pidOf,
      (pid: number) => this.alive.has(pid),
      ignore,
      (env: Configs) => env,
      async (args: SpawnArgs) => await Promise.resolve(args),
      async ({ serverArgs }: { serverArgs: SpawnArgs }) => await this.connect(serverArgs),
      () => 'identity',
      ignore,
      async ({ serverArgs }: { serverArgs: SpawnArgs }) => await this.connect(serverArgs),
      () => ({}),
      () => 'protocol',
      'resource-updated',
      'resource-list-changed',
      'tool-list-changed',
      String,
      { addToCounter: ignore },
      MINUTE,
      never,
      () => true,
      () => MINUTE,
      () => false,
      () => false,
      { safeParse: (data: ToolResult) => ({ success: true, data }) },
      MINUTE,
      () => false,
      ignore,
      Error,
      (name: string) => this.module(name),
      { env: this.env, pid: 1 },
      (callback: () => void, delay: number) => this.schedule(callback, delay),
      (timer: Timer | undefined) => {
        if (timer !== undefined) {
          timer.active = false;
        }
      },
      async (pending: Promise<void>) => {
        await pending;
      },
    );
    this.hub = new Hub({
      userMcpConfigs: configs ?? { [SERVER]: STDIO_CONFIG },
      logger,
      onToolsListChanged: async (name) => {
        this.changed.push(name);
        await this.hub.listToolsForServer(name);
      },
    });
    Object.assign(this.hub, {
      applyToolConfig: (_name: string, tools: Tool[]) => tools,
      persistCatalog: ignore,
      discardCatalog: ignore,
    });
    this.hub.killServerProcessTree = async (pid) => {
      this.killed.push(pid);
      this.alive.delete(pid);
      await Promise.resolve();
    };
  }

  async listed(name = SERVER): Promise<Tool[]> {
    const { tools } = await this.hub.listToolsForServer(name);
    return tools;
  }

  get pending(): Timer[] {
    return this.timers.filter((timer) => timer.active);
  }

  get dormant(): boolean {
    const server = this.hub.servers[SERVER];
    return server !== undefined && '$ODMz' in server;
  }

  seedCache(tools: Tool[] = TOOLS, name = SERVER, config: ServerConfig = STDIO_CONFIG): void {
    this.files.set(cacheFileOf(name, config), JSON.stringify(tools));
  }

  cached(name = SERVER, config: ServerConfig = STDIO_CONFIG): string | undefined {
    return this.files.get(cacheFileOf(name, config));
  }

  async fireIdle(): Promise<void> {
    const [timer, ...rest] = this.pending;
    if (timer === undefined || rest.length > 0) {
      throw new Error(`expected exactly one pending timer, found ${this.pending.length}`);
    }
    timer.active = false;
    timer.callback();
    await HubWorld.settle();
  }

  hold(kind: HoldKind): () => void {
    const held = Promise.withResolvers<boolean>();
    this.holds.set(kind, held.promise);
    return () => {
      held.resolve(true);
    };
  }

  private async held(kind: HoldKind): Promise<void> {
    const hold = this.holds.get(kind);
    this.holds.delete(kind);
    await hold;
  }

  static async settle(): Promise<void> {
    await Bun.sleep(0);
    await Bun.sleep(0);
  }

  private schedule(callback: () => void, delay: number): Timer {
    const timer = { delay, active: true, callback, unref: ignore };
    this.timers.push(timer);
    return timer;
  }

  private async connect(args: SpawnArgs): Promise<Connection> {
    this.spawned.push(args);
    await this.held('spawn');
    if (this.failSpawns > 0) {
      this.failSpawns -= 1;
      throw new Error('spawn failed');
    }
    const pid = this.nextPid;
    this.nextPid += 1;
    this.alive.add(pid);
    return { client: this.client(), transport: this.transport(pid) };
  }

  private transport(pid: number): Transport {
    return {
      pid,
      close: async () => {
        await this.held('close');
        this.closed.push(pid);
        if (this.exitOnClose) {
          this.alive.delete(pid);
        }
        await Promise.resolve();
      },
    };
  }

  private client(): FakeClient {
    return {
      listTools: async () => {
        this.calls.push('listTools');
        return await Promise.resolve({ tools: this.tools });
      },
      callTool: async (request) => {
        this.calls.push(`callTool:${request.name}`);
        await this.held('call');
        return { content: [{ type: 'text', text: 'ok' }] };
      },
      readResource: async (request) => {
        this.calls.push(`readResource:${request.uri}`);
        return await Promise.resolve({ contents: [{ uri: request.uri, text: 'body' }] });
      },
      subscribeResource: async () => {
        this.calls.push('subscribeResource');
        await Promise.resolve();
      },
      unsubscribeResource: async () => {
        this.calls.push('unsubscribeResource');
        await Promise.resolve();
      },
      listResources: async () => {
        await this.held('list');
        return { resources: [{ uri: 'live://a' }] };
      },
      listResourceTemplates: async () => {
        await this.held('list');
        return { resourceTemplates: [{ uri: 'live://{id}' }] };
      },
      getServerVersion: () => ({ name: 'fake', version: '1' }),
      setNotificationHandler: ignore,
    };
  }

  private module(name: string) {
    if (name === 'os') {
      return { homedir: () => HOME };
    }
    if (name === 'crypto') {
      return { createHash };
    }
    if (name === 'fs') {
      return fakeFs(this.files);
    }
    throw new Error(`unexpected require("${name}")`);
  }
}
