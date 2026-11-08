import { afterAll, describe, expect, test } from 'bun:test';
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { readMcpConfig } from '../../doctor/read.ts';
import { makeTempDir } from '../../temp.ts';
import { stdioServers } from '../mcp-children.ts';
import {
  FIXTURE_NAME,
  FIXTURE_SCRIPT,
  fixtureCatalogs,
  fixtureConfig,
  forgetFixtureCatalogs,
  toolsCacheName,
  writeFixture,
} from '../mcp-fixture.ts';

const REPLY_TIMEOUT_MS = 5000;

describe('fixtureConfig is one stdio server the probe can find in ps', () => {
  const config = fixtureConfig('/scratch/dir', '/opt/bun');

  test('the runtime runs the script in the scratch dir', () => {
    expect(config).toEqual({
      mcpServers: {
        [FIXTURE_NAME]: { command: '/opt/bun', args: [`/scratch/dir/${FIXTURE_SCRIPT}`] },
      },
    });
  });

  test('its signature is the script path, unique to the scratch dir', () => {
    expect(stdioServers(config)).toEqual([
      { name: FIXTURE_NAME, signature: `/scratch/dir/${FIXTURE_SCRIPT}` },
    ]);
  });
});

describe('toolsCacheName follows the mcp-idle cache key', () => {
  test('a 16-digit hex name per server config', () => {
    const entry = fixtureConfig('/a', '/opt/bun').mcpServers[FIXTURE_NAME] ?? {};
    expect(toolsCacheName(FIXTURE_NAME, entry)).toMatch(/^[0-9a-f]{16}\.json$/u);
  });

  test('another scratch dir is another cache entry, so every run starts cold', () => {
    const one = fixtureConfig('/a', '/opt/bun').mcpServers[FIXTURE_NAME] ?? {};
    const two = fixtureConfig('/b', '/opt/bun').mcpServers[FIXTURE_NAME] ?? {};
    expect(toolsCacheName(FIXTURE_NAME, one)).not.toBe(toolsCacheName(FIXTURE_NAME, two));
  });
});

describe('writeFixture leaves a project Droid loads and a server that answers', () => {
  const dir = makeTempDir('mcp-fixture-test');
  const config = writeFixture(dir, process.execPath);
  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  test('the project mcp.json holds the fixture config', () => {
    expect(readMcpConfig(path.join(dir, '.factory', 'mcp.json'))).toEqual(config);
  });

  test(
    'the server answers initialize and tools/list over stdio',
    async () => {
      const script = path.join(dir, FIXTURE_SCRIPT);
      expect(readFileSync(script, 'utf-8')).toContain(FIXTURE_NAME);
      const requests = [
        { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18' } },
        { jsonrpc: '2.0', method: 'notifications/initialized' },
        { jsonrpc: '2.0', id: 2, method: 'tools/list' },
      ];
      const input = requests.map((request) => `${JSON.stringify(request)}\n`).join('');
      const server = Bun.spawn([process.execPath, script], {
        stdin: new Blob([input]),
        stdout: 'pipe',
      });
      const output = await new Response(server.stdout).text();
      expect(await server.exited).toBe(0);
      const replies: unknown = JSON.parse(`[${output.trim().split('\n').join(',')}]`);
      expect(replies).toMatchObject([
        { id: 1, result: { protocolVersion: '2025-06-18', serverInfo: { name: FIXTURE_NAME } } },
        { id: 2, result: { tools: [{ name: 'ping' }] } },
      ]);
    },
    REPLY_TIMEOUT_MS,
  );
});

describe('fixture catalogs are the persisted tool lists Droid seeds a new session from', () => {
  const dir = makeTempDir('mcp-catalogs-test');
  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  const persist = (name: string, serverName: string): void => {
    writeFileSync(path.join(dir, name), JSON.stringify({ serverName, digest: 'd', tools: [] }));
  };

  test('only catalogs of the fixture server are listed, backups included', () => {
    persist('a.json', FIXTURE_NAME);
    persist('a.json.bak', FIXTURE_NAME);
    persist('b.json', 'chrome-devtools');
    writeFileSync(path.join(dir, 'c.json'), 'not json');
    expect([...fixtureCatalogs(dir)].toSorted()).toEqual(['a.json', 'a.json.bak']);
  });

  test('forgetting removes the fixture catalogs written since the mark and nothing else', () => {
    const before = fixtureCatalogs(dir);
    persist('d.json', FIXTURE_NAME);
    persist('e.json', 'chrome-devtools');
    forgetFixtureCatalogs(before, dir);
    expect(existsSync(path.join(dir, 'd.json'))).toBe(false);
    expect(existsSync(path.join(dir, 'a.json'))).toBe(true);
    expect(existsSync(path.join(dir, 'b.json'))).toBe(true);
    expect(existsSync(path.join(dir, 'e.json'))).toBe(true);
  });

  test('a missing folder holds no catalogs', () => {
    expect(fixtureCatalogs(path.join(dir, 'nowhere')).size).toBe(0);
  });
});
