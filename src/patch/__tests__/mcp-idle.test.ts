import { describe, expect, test } from 'bun:test';

import { DEFAULT_MCP_IDLE_MS, MCP_IDLE_ENV, MIN_MCP_IDLE_MS } from '../mcp-idle-patches.ts';
import {
  FIRST_PID,
  HTTP_CONFIG,
  HubWorld,
  SERVER,
  STDIO_CONFIG,
  TOOLS,
} from './mcp-idle-harness.ts';
import type { ServerConfig } from './mcp-idle-harness.ts';

async function reloadWith(world: HubWorld, config: ServerConfig): Promise<void> {
  await world.hub.removeServer(SERVER);
  await world.hub.addServer(SERVER, config);
}

const NEW_TOOLS = [...TOOLS, { name: 'navigate_page' }];
const CHANGED_CONFIG = { ...STDIO_CONFIG, args: ['-y', 'chrome-devtools-mcp', '--headless'] };

async function stillPending(): Promise<boolean> {
  await HubWorld.settle();
  return false;
}

async function isSettled(promise: Promise<void>): Promise<boolean> {
  const done = async (): Promise<boolean> => {
    await promise;
    return true;
  };
  return await Promise.race([done(), stillPending()]);
}

async function dormantWorld(): Promise<HubWorld> {
  const world = new HubWorld();
  world.seedCache();
  await world.hub.addServer(SERVER, STDIO_CONFIG);
  return world;
}

async function liveWorld(): Promise<HubWorld> {
  const world = await dormantWorld();
  await world.hub.callTool(SERVER, 'click');
  await HubWorld.settle();
  return world;
}

describe('starting a session', () => {
  test('a cached tool list leaves the server dormant and lists its tools without spawning', async () => {
    const world = await dormantWorld();

    expect(world.dormant).toBe(true);
    expect(world.spawned).toEqual([]);
    expect(await world.hub.listToolsForServer(SERVER)).toEqual(TOOLS);
    expect(world.calls).toEqual([]);
    expect(world.pending).toEqual([]);
  });

  test('without a cache it spawns as before, writes the list to disk and arms the idle timer', async () => {
    const world = new HubWorld();
    await world.hub.addServer(SERVER, STDIO_CONFIG);

    expect(world.spawned).toHaveLength(1);
    expect(world.dormant).toBe(false);

    expect(await world.hub.listToolsForServer(SERVER)).toEqual(TOOLS);
    await HubWorld.settle();

    expect(world.cached()).toBe(JSON.stringify(TOOLS));
    expect(world.pending.map((timer) => timer.delay)).toEqual([DEFAULT_MCP_IDLE_MS]);
  });

  test('an http server connects at once even with a cache file and never gets an idle timer', async () => {
    const world = new HubWorld({ remote: HTTP_CONFIG });
    world.seedCache(TOOLS, 'remote', HTTP_CONFIG);
    await world.hub.addServer('remote', HTTP_CONFIG);
    await world.hub.callTool('remote', 'click');
    await HubWorld.settle();

    expect(world.spawned.map((args) => args.url)).toEqual([HTTP_CONFIG.url]);
    expect(world.pending).toEqual([]);
  });
});

describe('waking', () => {
  test('the first tool call spawns the server once and then runs the call', async () => {
    const world = await dormantWorld();

    await world.hub.callTool(SERVER, 'click');

    expect(world.spawned).toHaveLength(1);
    expect(world.dormant).toBe(false);
    expect(world.calls).toContain('callTool:click');
  });

  test('three concurrent calls share one spawn', async () => {
    const world = await dormantWorld();

    await Promise.all([
      world.hub.callTool(SERVER, 'click'),
      world.hub.callTool(SERVER, 'click'),
      world.hub.callTool(SERVER, 'click'),
    ]);

    expect(world.spawned).toHaveLength(1);
    expect(world.calls.filter((call) => call === 'callTool:click')).toHaveLength(3);
  });

  test('a failed wake fails the call, keeps the server dormant, and the next call retries', async () => {
    const world = await dormantWorld();
    world.failSpawns = 1;

    const failure = await world.hub.callTool(SERVER, 'click').then(() => 'resolved', String);
    expect(failure).toBe('Error: spawn failed');
    expect(world.dormant).toBe(true);
    expect(world.pending).toEqual([]);

    await world.hub.callTool(SERVER, 'click');

    expect(world.spawned).toHaveLength(2);
    expect(world.dormant).toBe(false);
  });

  test('a config reload during a pending wake leaves no process behind', async () => {
    const world = await dormantWorld();
    const release = world.hold('spawn');
    const call = Promise.allSettled([world.hub.callTool(SERVER, 'click')]);
    await HubWorld.settle();

    const reload = reloadWith(world, CHANGED_CONFIG);
    await HubWorld.settle();
    release();
    await reload;
    await call;
    await world.hub.removeServer(SERVER);

    expect(world.spawned).toHaveLength(2);
    expect(world.alive).toEqual(new Set());
  });

  test('reading a resource wakes the server', async () => {
    const world = await dormantWorld();

    await world.hub.readResource(SERVER, 'live://a');

    expect(world.spawned).toHaveLength(1);
    expect(world.calls).toContain('readResource:live://a');
  });

  test('subscribing to a resource wakes the server', async () => {
    const world = await dormantWorld();

    await world.hub.subscribeToServerResource(SERVER, 'live://a');

    expect(world.spawned).toHaveLength(1);
    expect(world.calls).toContain('subscribeResource');
  });
});

describe('refreshing the tool list after a wake', () => {
  test('a changed list rewrites the cache and reports the change', async () => {
    const world = await dormantWorld();
    world.tools = NEW_TOOLS;

    await world.hub.callTool(SERVER, 'click');
    await HubWorld.settle();

    expect(world.cached()).toBe(JSON.stringify(NEW_TOOLS));
    expect(world.changed).toEqual([SERVER]);
    expect(await world.hub.listToolsForServer(SERVER)).toEqual(NEW_TOOLS);
  });

  test('an unchanged list writes nothing and reports nothing', async () => {
    const world = await dormantWorld();
    const before = new Map(world.files);

    await world.hub.callTool(SERVER, 'click');
    await HubWorld.settle();

    expect(world.calls).toContain('listTools');
    expect(world.files).toEqual(before);
    expect(world.changed).toEqual([]);
  });
});

describe('sleeping when idle', () => {
  test('the idle timer puts the server back to sleep and kills a process that outlived close', async () => {
    const world = await liveWorld();

    await world.fireIdle();

    expect(world.dormant).toBe(true);
    expect(world.closed).toEqual([FIRST_PID]);
    expect(world.killed).toEqual([FIRST_PID]);
    expect(await world.hub.listToolsForServer(SERVER)).toEqual(TOOLS);
  });

  test('a process that exits on close is not killed', async () => {
    const world = await liveWorld();
    world.exitOnClose = true;

    await world.fireIdle();

    expect(world.closed).toEqual([FIRST_PID]);
    expect(world.killed).toEqual([]);
  });

  test('the next call after sleeping spawns a fresh process', async () => {
    const world = await liveWorld();
    await world.fireIdle();

    await world.hub.callTool(SERVER, 'click');

    expect(world.spawned).toHaveLength(2);
    expect(world.dormant).toBe(false);
  });

  test('no timer runs while a call is in flight, and it re-arms when the call finishes', async () => {
    const world = await liveWorld();
    const release = world.hold('call');

    const call = world.hub.callTool(SERVER, 'click');
    await HubWorld.settle();
    expect(world.pending).toEqual([]);

    release();
    await call;

    expect(world.pending).toHaveLength(1);
    expect(world.dormant).toBe(false);
  });

  test.each(['listResourcesForServer', 'listResourceTemplatesForServer'] as const)(
    'no timer runs while a live %s request is in flight',
    async (method) => {
      const world = await liveWorld();
      const release = world.hold('list');

      const listing = world.hub[method](SERVER);
      await HubWorld.settle();
      expect(world.pending).toEqual([]);

      release();
      expect(await listing).toHaveLength(1);
      expect(world.pending).toHaveLength(1);
    },
  );

  test('an exit during an idle stop waits until the old process is stopped', async () => {
    const world = await liveWorld();
    const release = world.hold('close');
    await world.fireIdle();

    const exit = world.hub.removeServer(SERVER);
    expect(await isSettled(exit)).toBe(false);

    release();
    await exit;

    expect(world.closed).toEqual([FIRST_PID]);
    expect(world.alive).toEqual(new Set());
  });

  test('an exit after a wake that raced an idle stop still waits for the old process', async () => {
    const world = await liveWorld();
    const release = world.hold('close');
    await world.fireIdle();
    await world.hub.callTool(SERVER, 'click');

    const exit = world.hub.removeServer(SERVER);
    expect(await isSettled(exit)).toBe(false);

    release();
    await exit;

    expect(world.spawned).toHaveLength(2);
    expect(world.alive).toEqual(new Set());
  });

  test('a live resource subscription keeps the server awake and re-arms the timer', async () => {
    const world = await liveWorld();
    world.hub.clientResourceSubscriptions[SERVER] = { 'live://a': new Set(['client']) };
    await world.hub.subscribeToServerResource(SERVER, 'live://a');

    await world.fireIdle();

    expect(world.dormant).toBe(false);
    expect(world.closed).toEqual([]);
    expect(world.pending).toHaveLength(1);
  });

  test('removing a server cancels its idle timer', async () => {
    const world = await liveWorld();

    await world.hub.removeServer(SERVER);

    expect(world.pending).toEqual([]);
    expect(world.hub.servers[SERVER]).toBeUndefined();
  });
});

describe('a dormant server', () => {
  test('lists no resources or templates and does not wake', async () => {
    const world = await dormantWorld();

    expect(await world.hub.listResourcesForServer(SERVER)).toEqual([]);
    expect(await world.hub.listResourceTemplatesForServer(SERVER)).toEqual([]);
    expect(world.spawned).toEqual([]);
  });

  test('ignores an unsubscribe', async () => {
    const world = await dormantWorld();

    await world.hub.unsubscribeFromServerResource(SERVER, 'live://a');

    expect(world.calls).toEqual([]);
    expect(world.spawned).toEqual([]);
  });

  test('can be removed without a process to stop', async () => {
    const world = await dormantWorld();

    await world.hub.removeServer(SERVER);

    expect(world.hub.servers[SERVER]).toBeUndefined();
    expect(world.hub.toolsListCache.has(SERVER)).toBe(false);
    expect(world.killed).toEqual([]);
  });

  test('can be retried and restarted, and stays dormant', async () => {
    const world = await dormantWorld();

    await world.hub.retryServer(SERVER);
    expect(await world.hub.restartStdioServers()).toEqual([SERVER]);

    expect(world.dormant).toBe(true);
    expect(world.spawned).toEqual([]);
    expect(await world.hub.listToolsForServer(SERVER)).toEqual(TOOLS);
  });
});

async function delayWith(value: string): Promise<number | undefined> {
  const world = new HubWorld();
  world.env[MCP_IDLE_ENV] = value;
  await world.hub.addServer(SERVER, STDIO_CONFIG);
  return world.pending[0]?.delay;
}

describe(`the ${MCP_IDLE_ENV} override`, () => {
  test('takes a finite value of at least a second', async () => {
    expect(await delayWith(String(MIN_MCP_IDLE_MS))).toBe(MIN_MCP_IDLE_MS);
    expect(await delayWith('5000')).toBe(5000);
  });

  test('falls back to the default for anything shorter, infinite or not a number', async () => {
    for (const value of [String(MIN_MCP_IDLE_MS - 1), 'Infinity', 'soon', '']) {
      // oxlint-disable-next-line no-await-in-loop
      expect(await delayWith(value)).toBe(DEFAULT_MCP_IDLE_MS);
    }
  });
});
