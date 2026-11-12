import { AsyncLocalStorage } from 'node:async_hooks';
import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';

import { patchSource } from '../../binary/apply.ts';
import { BUILD_FLAGS } from '../../binary/build-flags.ts';
import { MCP_TOOLS_KEY_LENGTH, MCP_TOOLS_UNDER_HOME, mcpIdlePatches } from '../mcp-idle-patches.ts';
import { markerStatement } from '../patches.ts';
import { fakeFs } from './mcp-fake-fs.ts';
import { STOCK_HUB_MODULE } from './mcp-hub-stock.ts';
import type {
  Configs,
  Connection,
  FakeClient,
  Hub,
  HubClass,
  Listing,
  Logger,
  ServerConfig,
  Tool,
  ToolResult,
  Transport,
} from './mcp-hub-types.ts';
import { payloadFunction } from './payload.ts';

export const SERVER = 'chrome-devtools';
export const HOME = '/home/tester';
export const FIRST_PID = 4100;
const MINUTE = 60_000;
const TEARDOWN_BOUND_MS = 7000;

export const STDIO_CONFIG: ServerConfig = {
  type: 'stdio',
  command: 'npx',
  args: ['-y', 'chrome-devtools-mcp'],
};
export const HTTP_CONFIG: ServerConfig = { type: 'http', url: 'https://mcp.example.test/' };
export const TOOLS: Tool[] = [{ name: 'take_screenshot' }, { name: 'click' }];

type HoldKind = 'spawn' | 'call' | 'close' | 'list';

export interface Timer {
  delay: number;
  active: boolean;
  callback: () => void;
  unref: () => void;
}

type SpawnArgs = Pick<ServerConfig, 'command' | 'url'>;

const PATCHED = patchSource(
  [{ name: 'hub.js', text: STOCK_HUB_MODULE }],
  mcpIdlePatches,
)[0].text.replace(markerStatement(mcpIdlePatches, BUILD_FLAGS), '');

function bareRecord(): Configs {
  const record: Configs = {};
  Object.setPrototypeOf(record, null);
  return record;
}

interface Bound {
  signal?: AbortSignal;
  mapError?: (error: Error) => Error;
}

async function withBound<T>(
  { signal, mapError }: Bound,
  run: (options: { signal: AbortSignal }) => Promise<T>,
): Promise<T> {
  try {
    return await run({ signal: signal ?? new AbortController().signal });
  } catch (error) {
    if (mapError === undefined || !(error instanceof Error)) {
      throw error;
    }
    throw mapError(error);
  }
}

async function listing(client: FakeClient): Promise<Listing> {
  const { tools } = await client.listTools();
  return {
    client,
    tools,
    callDefinitions: new Map(tools.map((tool) => [tool.name, tool])),
    uncompilableOutputSchemas: [],
  };
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
  readonly alive = new Set<number>();
  readonly owned = new Set<number>();
  readonly changed: string[] = [];
  readonly calls: string[] = [];
  readonly env: Record<string, string> = {};
  tools: Tool[] = TOOLS;
  failSpawns = 0;
  era: 'legacy' | 'modern' = 'legacy';
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
    const stand = {
      _t: bareRecord,
      wi: (value: Configs) => ({ ...value }),
      Xu: () => this.era === 'modern',
      i: Error,
      N5: ignore,
      IH: never,
      $a: (env: Configs) => env,
      Uu: async (args: SpawnArgs) => await Promise.resolve(args),
      $u: async ({ serverArgs }: { serverArgs: SpawnArgs }) => await this.connect(serverArgs),
      H_: () => 'identity',
      CB: ignore,
      sV: async ({ serverArgs }: { serverArgs: SpawnArgs }) => await this.connect(serverArgs),
      es: () => ({}),
      Xo: never,
      EPe: String,
      H: { addToCounter: ignore },
      LK: TEARDOWN_BOUND_MS,
      AC: withBound,
      bm: () => MINUTE,
      dNe: MINUTE,
      $d: async (pending: Promise<unknown>) => await pending,
      ne: never,
      cV: listing,
      hNe: MINUTE,
      a7: new AsyncLocalStorage<unknown>(),
      d4: (freshness?: { cacheable: boolean; expiresAtMonotonicMs: number }) =>
        freshness === undefined ||
        (freshness.cacheable && performance.now() < freshness.expiresAtMonotonicMs),
      eqT: JSON.stringify,
      vr: { default: { isEqual: isDeepStrictEqual } },
      mV: ignore,
      pV: () => false,
      L0e: ignore,
      SB: Error,
      Tr: TypeError,
      ute: 'header-mismatch',
      yB: { safeParse: (data: ToolResult) => ({ success: true, data }) },
      wv: MINUTE,
      require: (name: string) => this.module(name),
      process: { env: this.env, pid: 1 },
      setTimeout: (callback: () => void, delay: number) => this.schedule(callback, delay),
      clearTimeout: (timer: Timer | undefined) => {
        if (timer !== undefined) {
          timer.active = false;
        }
      },
    };
    const build = payloadFunction<unknown[], HubClass>(Object.keys(stand), `${PATCHED}return TV`);
    const Hub = build(...Object.values(stand));
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
      protocolEraFor: ignore,
      logInvalidToolsTransition: ignore,
      logUncompilableOutputSchemasTransition: ignore,
    });
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
    this.owned.add(pid);
    return { client: this.client(), transport: this.transport(pid) };
  }

  private transport(pid: number): Transport {
    return {
      pid,
      close: async () => {
        await this.held('close');
        this.closed.push(pid);
        this.alive.delete(pid);
        this.owned.delete(pid);
        await Promise.resolve();
      },
    };
  }

  private client(): FakeClient {
    return {
      transport: {},
      listTools: async () => {
        this.calls.push('listTools');
        return await Promise.resolve({ tools: this.tools });
      },
      callTool: async (request, options) => {
        options?.beforeSend?.();
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
      request: async ({ method }) => {
        await this.held('list');
        return method === 'resources/list'
          ? { resources: [{ uri: 'live://a' }] }
          : { resourceTemplates: [{ uri: 'live://{id}' }] };
      },
      getServerVersion: () => ({ name: 'fake', version: '1' }),
      getNegotiatedProtocolVersion: () => 'protocol',
      getProtocolEra: () => this.era,
      getServerCapabilities: () => ({}),
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

async function stillPending(): Promise<boolean> {
  await HubWorld.settle();
  return false;
}

export async function isSettled(promise: Promise<void>): Promise<boolean> {
  const done = async (): Promise<boolean> => {
    await promise;
    return true;
  };
  return await Promise.race([done(), stillPending()]);
}

export async function dormantWorld(): Promise<HubWorld> {
  const world = new HubWorld();
  world.seedCache();
  await world.hub.addServer(SERVER, STDIO_CONFIG);
  return world;
}

export async function liveWorld(): Promise<HubWorld> {
  const world = await dormantWorld();
  await world.hub.callTool(SERVER, 'click');
  await HubWorld.settle();
  return world;
}
