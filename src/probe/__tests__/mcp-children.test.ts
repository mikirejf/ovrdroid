import { describe, expect, test } from 'bun:test';

import { describeMcpChildren, envPair, readMcpChildren, stdioServers } from '../mcp-children.ts';
import { parseParents } from '../tree.ts';

const CONFIG = {
  mcpServers: {
    'chrome-devtools': {
      type: 'stdio',
      command: 'npx',
      args: ['-y', 'chrome-devtools-mcp@latest', '--browserUrl', 'http://127.0.0.1:9333'],
    },
    local: { command: '/usr/local/bin/local-mcp' },
    remote: { type: 'http', url: 'https://mcp.example.test/' },
    off: { command: 'node', args: ['off.js'], disabled: true },
  },
};

const LISTING = [
  '  PID  PPID COMMAND',
  '  100     1 /Users/x/.local/bin/droid',
  '  200   100 node /opt/homebrew/bin/npx -y chrome-devtools-mcp@latest --browserUrl http://127.0.0.1:9333',
  '  300   200 node /Users/x/.npm/_npx/abc/node_modules/.bin/chrome-devtools-mcp@latest --browserUrl',
  '  400     1 node /opt/homebrew/bin/npx -y chrome-devtools-mcp@latest',
  '  500   100 rg --files',
].join('\n');

describe('stdioServers picks what the probe can look for', () => {
  test('the first plain argument names a server, flags are skipped', () => {
    expect(stdioServers(CONFIG)).toContainEqual({
      name: 'chrome-devtools',
      signature: 'chrome-devtools-mcp@latest',
    });
  });

  test('a server with no arguments is found by its command name', () => {
    expect(stdioServers(CONFIG)).toContainEqual({ name: 'local', signature: 'local-mcp' });
  });

  test('remote and disabled servers are left out, since droid never spawns them', () => {
    expect(stdioServers(CONFIG).map((server) => server.name)).toEqual(['chrome-devtools', 'local']);
  });
});

describe('readMcpChildren looks only under the launched droid', () => {
  const rows = parseParents(LISTING);
  const readings = readMcpChildren(rows, 100, stdioServers(CONFIG));

  test('a running server reports its topmost process and the size of its tree', () => {
    expect(readings[0]).toEqual({ name: 'chrome-devtools', pid: 200, processes: 2 });
  });

  test('a copy owned by another droid does not count', () => {
    expect(readMcpChildren(rows, 999, stdioServers(CONFIG))[0]?.pid).toBeUndefined();
  });

  test('a server with no process is reported as not running', () => {
    expect(readings[1]).toEqual({ name: 'local', pid: undefined, processes: 0 });
  });
});

describe('describeMcpChildren says it in words', () => {
  test('one line per server', () => {
    expect(
      describeMcpChildren([
        { name: 'chrome-devtools', pid: 200, processes: 2 },
        { name: 'local', pid: undefined, processes: 0 },
      ]),
    ).toBe(
      'chrome-devtools: running, pid 200, 2 processes in its tree\nlocal: not running (dormant)',
    );
  });

  test('an empty config says there was nothing to count', () => {
    expect(describeMcpChildren([])).toContain('nothing to count');
  });
});

describe('envPair collects repeated --env options', () => {
  test('pairs accumulate and a value may contain =', () => {
    expect(envPair('B=x=y', envPair('A=1'))).toEqual({ A: '1', B: 'x=y' });
  });

  test('a pair without a key is refused', () => {
    expect(() => envPair('=1')).toThrow('expected KEY=VALUE');
  });
});
