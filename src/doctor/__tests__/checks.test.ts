import { describe, expect, test } from 'bun:test';

import type { McpConfig, McpServerEntry } from '../checks.ts';
import { checkMcpConfig } from '../checks.ts';
import { formatFixed, formatReport } from '../report.ts';
import { scanMcpConfig } from '../scan.ts';

function configOf(entry: McpServerEntry): McpConfig {
  return { mcpServers: { 'chrome-devtools': entry } };
}

describe('checkMcpConfig flags the package wrapper', () => {
  test('npx with the server package is a footgun', () => {
    const found = checkMcpConfig(
      configOf({ command: 'npx', args: ['-y', 'chrome-devtools-mcp@latest'] }),
    );
    expect(found).toHaveLength(1);
    expect(found[0]?.id).toBe('npm-exec-wrapper');
    expect(found[0]?.server).toBe('chrome-devtools');
  });

  test('npm exec and absolute wrapper paths count too', () => {
    expect(
      checkMcpConfig(configOf({ command: 'npm', args: ['exec', 'chrome-devtools-mcp'] })),
    ).toHaveLength(1);
    expect(
      checkMcpConfig(configOf({ command: '/opt/homebrew/bin/npx', args: ['-y', 'x'] })),
    ).toHaveLength(1);
    expect(checkMcpConfig(configOf({ command: 'npx.cmd', args: [] }))).toHaveLength(1);
  });

  test('npm and npx wrappers point at the autofix, others do not', () => {
    expect(checkMcpConfig(configOf({ command: 'npx', args: ['-y', 'x'] }))[0]?.fixHint).toBe(
      'ovrdroid doctor --fix',
    );
    expect(checkMcpConfig(configOf({ command: 'npm', args: ['exec', 'x'] }))[0]?.fixHint).toBe(
      'ovrdroid doctor --fix',
    );
    expect(checkMcpConfig(configOf({ command: 'bunx', args: ['x'] }))[0]?.fixHint).toBeUndefined();
  });

  test('a pinned entry point is clean', () => {
    expect(
      checkMcpConfig(
        configOf({
          command: 'node',
          args: ['/Users/x/.npm/_npx/hash/node_modules/chrome-devtools-mcp/bin.js'],
        }),
      ),
    ).toHaveLength(0);
  });

  test('a disabled wrapper spawns nothing and is not a footgun', () => {
    expect(
      checkMcpConfig(configOf({ command: 'npx', args: ['-y', 'x'], disabled: true })),
    ).toHaveLength(0);
  });

  test('missing shapes yield nothing rather than throwing', () => {
    expect(checkMcpConfig('nope')).toHaveLength(0);
    expect(checkMcpConfig(null)).toHaveLength(0);
    expect(checkMcpConfig({})).toHaveLength(0);
    expect(checkMcpConfig({ mcpServers: null })).toHaveLength(0);
    expect(checkMcpConfig({ mcpServers: { broken: null } })).toHaveLength(0);
    expect(checkMcpConfig(configOf({ command: 'node', args: [] }))).toHaveLength(0);
  });

  test('one bad server among good ones reports only the bad one', () => {
    const found = checkMcpConfig({
      mcpServers: {
        pinned: { command: 'node', args: ['/x/bin.js'] },
        wrapped: { command: 'npx', args: ['-y', 'chrome-devtools-mcp@latest'] },
      },
    });
    expect(found.map((item) => item.server)).toEqual(['wrapped']);
  });
});

describe('report states problem, impact and fix', () => {
  test('a footgun formats all three lines', () => {
    const found = checkMcpConfig(
      configOf({ command: 'npx', args: ['-y', 'chrome-devtools-mcp@latest'] }),
    );
    expect(found).toHaveLength(1);
    const text = formatReport(found, '/tmp/mcp.json');
    expect(text).toContain('problem:');
    expect(text).toContain('impact:');
    expect(text).toContain('fix:');
    expect(text).toContain('chrome-devtools');
  });

  test('an autofixable footgun names its run command', () => {
    const found = checkMcpConfig(
      configOf({ command: 'npx', args: ['-y', 'chrome-devtools-mcp@latest'] }),
    );
    expect(formatReport(found, '/tmp/mcp.json')).toContain('run: ovrdroid doctor --fix');
    const manual = checkMcpConfig(configOf({ command: 'bunx', args: ['x'] }));
    expect(formatReport(manual, '/tmp/mcp.json')).not.toContain('run:');
  });

  test('a fix report names the backup and both sides of the rewrite', () => {
    const text = formatFixed(
      {
        fixed: [
          {
            server: 'chrome-devtools',
            fromCommand: 'npx',
            fromArgs: ['-y', 'chrome-devtools-mcp@latest'],
            toCommand: 'node',
            toArgs: ['/x/bin.js'],
          },
        ],
        backup: '/tmp/mcp.json.bak',
      },
      '/tmp/mcp.json',
    );
    expect(text).toContain('fixed 1 server in /tmp/mcp.json');
    expect(text).toContain('backup at /tmp/mcp.json.bak');
    expect(text).toContain('npx -y chrome-devtools-mcp@latest');
    expect(text).toContain('-> node /x/bin.js');
  });

  test('the report names the file and counts findings', () => {
    const found = checkMcpConfig(
      configOf({ command: 'npx', args: ['-y', 'chrome-devtools-mcp@latest'] }),
    );
    expect(formatReport(found, '/tmp/mcp.json')).toContain('/tmp/mcp.json');
    expect(formatReport(found, '/tmp/mcp.json')).toContain('1 footgun');
  });
});

describe('scan tolerates a missing or broken file', () => {
  test('an unreadable path scans to nothing', () => {
    expect(scanMcpConfig('/definitely/not/here/mcp.json')).toHaveLength(0);
  });

  test('a wrapper config on disk is found', () => {
    const path = `${import.meta.dir}/mcp-wrapper.fixture.json`;
    expect(scanMcpConfig(path).map((item) => item.server)).toEqual(['chrome-devtools']);
  });

  test('a pinned config on disk is clean', () => {
    const path = `${import.meta.dir}/mcp-pinned.fixture.json`;
    expect(scanMcpConfig(path)).toHaveLength(0);
  });
});
