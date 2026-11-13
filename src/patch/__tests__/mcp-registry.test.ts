import { describe, expect, test } from 'bun:test';

import {
  dormantWorld,
  HubWorld,
  liveWorld,
  SERVER,
  STDIO_CONFIG,
  TOOLS,
} from './mcp-idle-harness.ts';

async function offered(world: HubWorld): Promise<boolean> {
  const result = await world.hub.listToolsForServer(SERVER);
  expect(result.tools).toEqual(TOOLS);
  return world.hub.isToolListingCurrent(SERVER, result);
}

describe('the tool registry', () => {
  test.each([false, true])(
    'a seeded listing stops being current after startup with a disk cache: %s',
    async (cached) => {
      const world = new HubWorld();
      world.hub.seeds.set(SERVER, { tools: TOOLS });
      if (cached) {
        world.seedCache();
      }
      const seeded = await world.hub.listToolsForServer(SERVER);

      expect(seeded.seeded).toBe(true);
      expect(seeded.list).toBeUndefined();
      expect(world.hub.isToolListingCurrent(SERVER, seeded)).toBe(true);

      await world.hub.addServer(SERVER, STDIO_CONFIG);

      expect(world.dormant).toBe(cached);
      expect(world.hub.seeds.has(SERVER)).toBe(false);
      expect(world.hub.isToolListingCurrent(SERVER, seeded)).toBe(false);
      expect(await offered(world)).toBe(true);
    },
  );

  test("a dormant server's cached tools reach the tool registry", async () => {
    const world = await dormantWorld();

    expect(await offered(world)).toBe(true);
    expect(world.spawned).toEqual([]);
  });

  test("an idle-stopped server's cached tools reach the tool registry", async () => {
    const world = await liveWorld();
    await world.fireIdle();

    expect(world.dormant).toBe(true);
    expect(await offered(world)).toBe(true);
  });

  test('after a wake the fresh listing is current for the new connection', async () => {
    const world = await dormantWorld();

    await world.hub.callTool(SERVER, 'click');
    await HubWorld.settle();

    expect(world.dormant).toBe(false);
    expect(await offered(world)).toBe(true);
  });
});
