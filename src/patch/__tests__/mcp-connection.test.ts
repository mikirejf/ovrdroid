import { describe, expect, test } from 'bun:test';

import { dormantWorld, HubWorld, SERVER, STDIO_CONFIG } from './mcp-idle-harness.ts';

describe.each(['cold start', 'dormant wake'] as const)('%s', (start) => {
  test.each(['success', 'failure'] as const)(
    'releases stdio preparation after %s',
    async (outcome) => {
      const world = start === 'dormant wake' ? await dormantWorld() : new HubWorld();
      world.hub.cwd = '/project';
      world.spawnCwd = '/sandbox/project';
      world.failSpawns = Number(outcome === 'failure');
      const finishSpawn = world.hold('spawn');
      const connection = Promise.allSettled([
        start === 'dormant wake'
          ? world.hub.callTool(SERVER, 'click')
          : world.hub.addServer(SERVER, STDIO_CONFIG),
      ]);
      await HubWorld.settle();

      expect(world.prepared).toHaveLength(1);
      expect(world.prepared[0]).toMatchObject({ cwd: '/project', command: STDIO_CONFIG.command });
      expect(world.spawned).toHaveLength(1);
      expect(world.spawned[0]).toMatchObject({ cwd: '/sandbox/project' });
      expect(world.spawned[0]).not.toHaveProperty('release');
      expect(world.released).toEqual([]);

      finishSpawn();
      const [result] = await connection;

      expect(result.status).toBe(outcome === 'failure' ? 'rejected' : 'fulfilled');
      if (result.status === 'rejected') {
        expect(String(result.reason)).toBe('Error: spawn failed');
      }
      expect(world.released).toEqual(world.prepared);
      expect(world.released[0]).toBe(world.prepared[0]);
    },
  );
});
