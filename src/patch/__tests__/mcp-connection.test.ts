import { describe, expect, test } from 'bun:test';

import { HubWorld, SERVER, STDIO_CONFIG, TOOLS } from './mcp-idle-harness.ts';

const CONFIG = { ...STDIO_CONFIG, env: { SHARED: 'configured', EXTRA: 'server' } };

describe.each(['cold start', 'dormant wake'] as const)('%s', (start) => {
  test.each(['success', 'failure'] as const)(
    'merges stdio env and releases preparation after %s',
    async (outcome) => {
      const world = new HubWorld({ [SERVER]: CONFIG });
      if (start === 'dormant wake') {
        world.seedCache(TOOLS, SERVER, CONFIG);
        await world.hub.addServer(SERVER, CONFIG);
        expect(world.spawned).toEqual([]);
      }
      Object.assign(world.env, { SHARED: 'inherited', BASE: 'process' });
      world.hub.cwd = '/project';
      world.spawnCwd = '/sandbox/project';
      world.failSpawns = Number(outcome === 'failure');
      const finishSpawn = world.hold('spawn');
      const connection = Promise.allSettled([
        start === 'dormant wake'
          ? world.hub.callTool(SERVER, 'click')
          : world.hub.addServer(SERVER, CONFIG),
      ]);
      await HubWorld.settle();

      expect(world.prepared).toHaveLength(1);
      expect(world.prepared[0]).toMatchObject({ cwd: '/project', command: STDIO_CONFIG.command });
      expect(world.spawned).toHaveLength(1);
      expect(world.spawned[0]).toMatchObject({ cwd: '/sandbox/project' });
      expect(world.spawned[0]?.env).toEqual({
        SHARED: 'configured',
        EXTRA: 'server',
        BASE: 'process',
      });
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
