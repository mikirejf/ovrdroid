import { describe, expect, test } from 'bun:test';

import { HubWorld, SERVER, STDIO_CONFIG } from './mcp-idle-harness.ts';

async function dormantWorld(): Promise<HubWorld> {
  const world = new HubWorld();
  world.era = 'modern';
  world.seedCache();
  await world.hub.addServer(SERVER, STDIO_CONFIG);
  return world;
}

describe('MCP admission with dormant stdio servers', () => {
  test('the turn-start catalog refresh leaves dormant servers asleep', async () => {
    const world = await dormantWorld();
    expect(world.hub.getExpiredToolCatalogServers()).toEqual([]);
    expect(world.spawned).toEqual([]);
  });

  test('admission wakes a modern server before preparing its invocation', async () => {
    const world = await dormantWorld();
    expect(await world.hub.bindsInvocationAtAdmission(SERVER)).toBe(true);
    const prepared = await world.hub.prepareToolInvocation(SERVER, 'click');
    expect(prepared.isCurrent()).toBe(true);
    expect(world.spawned).toHaveLength(1);
    await world.hub.callTool(SERVER, 'click', {}, 'session', 'AGENT', undefined, prepared);
    expect(world.calls).toEqual(['listTools', 'callTool:click']);
  });

  test('admission waits for a seeded connection and then wakes it', async () => {
    const world = new HubWorld();
    world.era = 'modern';
    world.seedCache();
    world.hub.openPendingConnection(SERVER, STDIO_CONFIG);
    const admitted = world.hub.bindsInvocationAtAdmission(SERVER);
    await HubWorld.settle();
    expect(world.spawned).toEqual([]);
    await world.hub.addServer(SERVER, STDIO_CONFIG);
    expect(await admitted).toBe(true);
    expect(world.spawned).toHaveLength(1);
  });

  test('a legacy server still executes without a prepared invocation', async () => {
    const world = await dormantWorld();
    world.era = 'legacy';
    expect(await world.hub.bindsInvocationAtAdmission(SERVER)).toBe(false);
    await world.hub.callTool(SERVER, 'click');
    expect(world.calls).toContain('callTool:click');
  });

  test('a prepared invocation is rejected after the connection went idle', async () => {
    const world = await dormantWorld();
    await world.hub.bindsInvocationAtAdmission(SERVER);
    const prepared = await world.hub.prepareToolInvocation(SERVER, 'click');
    await world.fireIdle();
    expect(prepared.isCurrent()).toBe(false);
    const result = await world.hub
      .callTool(SERVER, 'click', {}, 'session', 'AGENT', undefined, prepared)
      .then(() => 'accepted', String);
    expect(result).toBe(
      'Error: The MCP tool catalog changed before execution; retry the tool call',
    );
    expect(world.calls.filter((call) => call.startsWith('callTool:'))).toEqual([]);
  });
});
