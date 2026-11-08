import { describe, expect, test } from 'bun:test';

import { dormantWorld, HubWorld, liveWorld, SERVER, TOOLS } from './mcp-idle-harness.ts';

async function offered(world: HubWorld): Promise<boolean> {
  const result = await world.hub.listToolsForServer(SERVER);
  expect(result.tools).toEqual(TOOLS);
  return world.hub.isToolListingCurrent(SERVER, result);
}

describe('the tool registry', () => {
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
