import { describe, expect, test } from 'bun:test';

import {
  describeLaunches,
  describeMcpChildren,
  describeToolTurns,
  envPair,
  judgeMcpChildren,
  readMcpChildren,
  runningServers,
  stdioServers,
} from '../mcp-children.ts';
import type { ModeReading } from '../mcp-children.ts';
import type { WakeReading } from '../mcp-wake-report.ts';
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

  test('an empty config says there was nothing to test', () => {
    expect(describeMcpChildren([])).toBe('nothing to test: no stdio MCP servers configured');
  });
});

describe('runningServers is what fails the probe', () => {
  test('a live process at session open is a failure', () => {
    const readings = [
      { name: 'chrome-devtools', pid: 200, processes: 2 },
      { name: 'local', pid: undefined, processes: 0 },
    ];
    expect(runningServers(readings).map((reading) => reading.name)).toEqual(['chrome-devtools']);
  });

  test('all servers dormant passes', () => {
    expect(runningServers([{ name: 'local', pid: undefined, processes: 0 }])).toEqual([]);
  });
});

describe('judgeMcpChildren passes only a run that exercised the patch', () => {
  const running = { name: 'ovrdroid-fixture', pid: 200, processes: 1 };
  const dormant = { name: 'ovrdroid-fixture', pid: undefined, processes: 0 };

  test('no servers to look for fails in the default fixture mode', () => {
    expect(judgeMcpChildren({ first: [], second: [] }, true)).toEqual({
      pass: false,
      reason: 'nothing tested: no stdio MCP servers to look for',
    });
  });

  test('no servers to look for fails with a real config too', () => {
    expect(judgeMcpChildren({ first: [], second: [] }, false).pass).toBe(false);
  });

  test('a fixture Droid never started on the cold launch tested nothing', () => {
    const verdict = judgeMcpChildren({ first: [dormant], second: [dormant] }, true);
    expect(verdict.pass).toBe(false);
    expect(verdict.reason).toContain('never started ovrdroid-fixture');
  });

  test('a real server already cached may stay dormant on both launches', () => {
    expect(judgeMcpChildren({ first: [dormant], second: [dormant] }, false).pass).toBe(true);
  });

  test('a server running on the second launch fails', () => {
    expect(judgeMcpChildren({ first: [running], second: [running] }, true)).toEqual({
      pass: false,
      reason: 'kept running from launch: ovrdroid-fixture',
    });
  });

  test('started cold, dormant once cached passes', () => {
    expect(judgeMcpChildren({ first: [running], second: [dormant] }, true).pass).toBe(true);
  });
});

function turn(
  mode: 'exec' | 'interactive',
  overrides: Partial<ModeReading['reading']> = {},
): ModeReading {
  return {
    mode,
    reading: { requests: 3, offered: 'deferred', ponged: true, ...overrides },
    awake: true,
  };
}

describe('judgeMcpChildren with a model turn per mode', () => {
  const dormant = { name: 'ovrdroid-fixture', pid: undefined, processes: 0 };
  const running = { name: 'ovrdroid-fixture', pid: 200, processes: 1 };
  const launches = { first: [running], second: [dormant] };

  test('dormant, offered and answered in both modes passes and says so', () => {
    const verdict = judgeMcpChildren(launches, true, {
      turns: [turn('interactive'), turn('exec')],
    });
    expect(verdict.pass).toBe(true);
    expect(verdict.reason).toBe(
      "every stdio server stayed dormant on the second launch, and the model was offered ovrdroid-fixture's tools and got pong back in interactive and exec",
    );
  });

  test('tools not offered in exec fails with the plain reason, interactive may pass', () => {
    const verdict = judgeMcpChildren(launches, true, {
      turns: [
        turn('interactive'),
        turn('exec', { requests: 1, offered: undefined, ponged: false }),
      ],
    });
    expect(verdict).toEqual({
      pass: false,
      reason:
        "exec: the model was not offered ovrdroid-fixture's tools while the server was dormant",
    });
  });

  test('both modes failing are both named, one line each', () => {
    const lost = { requests: 1, offered: undefined, ponged: false } as const;
    const verdict = judgeMcpChildren(launches, true, {
      turns: [turn('interactive', lost), turn('exec', lost)],
    });
    expect(verdict.reason.split('\n')).toEqual([
      "interactive: the model was not offered ovrdroid-fixture's tools while the server was dormant",
      "exec: the model was not offered ovrdroid-fixture's tools while the server was dormant",
    ]);
  });

  test('offered but no pong fails on the call', () => {
    const verdict = judgeMcpChildren(launches, true, {
      turns: [turn('interactive', { ponged: false })],
    });
    expect(verdict.reason).toBe('interactive: calling ping did not return pong');
  });

  test('a stub that was never asked tested nothing', () => {
    const verdict = judgeMcpChildren(launches, true, {
      turns: [turn('exec', { requests: 0, offered: undefined, ponged: false })],
    });
    expect(verdict.reason).toBe('exec: the model was never sent a request, so nothing was tested');
  });

  test('a server that kept running adds its line to the tool failures', () => {
    const verdict = judgeMcpChildren({ first: [running], second: [running] }, true, {
      turns: [turn('exec', { offered: undefined, ponged: false })],
    });
    expect(verdict.reason.split('\n')).toEqual([
      'kept running from launch: ovrdroid-fixture',
      "exec: the model was not offered ovrdroid-fixture's tools",
    ]);
  });

  test('the nothing-tested guard still comes first', () => {
    expect(
      judgeMcpChildren({ first: [dormant], second: [dormant] }, true, { turns: [turn('exec')] })
        .reason,
    ).toContain('never started ovrdroid-fixture');
  });
});

const ponged = { requests: 3, offered: 'deferred', ponged: true } as const;

function wakeReading(overrides: Partial<WakeReading> = {}): WakeReading {
  return {
    child: ponged,
    childSawRunning: false,
    quietBeforeFirst: true,
    first: ponged,
    stoppedAfterMs: 2400,
    wake: ponged,
    ...overrides,
  };
}

describe('judgeMcpChildren with the sleep-wake session', () => {
  const launches = {
    first: [{ name: 'ovrdroid-fixture', pid: 200, processes: 1 }],
    second: [{ name: 'ovrdroid-fixture', pid: undefined, processes: 0 }],
  };
  const turns = [turn('interactive'), turn('exec')];

  test('a sub-agent pong, an observed stop and a pong after it pass and say so', () => {
    const verdict = judgeMcpChildren(launches, true, { turns, wake: wakeReading() });
    expect(verdict.pass).toBe(true);
    expect(verdict.reason).toContain(
      "in a third session a sub-agent was offered ovrdroid-fixture's tools and got pong from a dormant server, the main agent's call then woke the server, the idle stop took it down 2.4s after that call",
    );
  });

  test('a server that never stopped fails the whole probe', () => {
    const verdict = judgeMcpChildren(launches, true, {
      turns,
      wake: wakeReading({ stoppedAfterMs: undefined }),
    });
    expect(verdict.pass).toBe(false);
    expect(verdict.reason).toContain('idle stop: ovrdroid-fixture was still running');
  });

  test('wake failures join the earlier ones, one line each', () => {
    const verdict = judgeMcpChildren(launches, true, {
      turns: [turn('exec', { ponged: false })],
      wake: wakeReading({ wake: { requests: 2, offered: 'deferred', ponged: false } }),
    });
    expect(verdict.reason.split('\n')).toEqual([
      'exec: calling ping did not return pong',
      'main agent after the stop: calling ping did not return pong',
    ]);
  });
});

describe('describeToolTurns says what each mode saw', () => {
  test('one line per mode with the offer, the answer and whether the server woke', () => {
    expect(
      describeToolTurns([
        {
          mode: 'interactive',
          reading: { requests: 3, offered: 'deferred', ponged: true },
          awake: true,
        },
        {
          mode: 'exec',
          reading: { requests: 1, offered: undefined, ponged: false },
          awake: undefined,
        },
      ]),
    ).toBe(
      [
        'one model turn per mode, against the cached tools:',
        '  interactive: ping listed in the deferred tools, pong came back, server running when the result came back (woke)',
        '  exec: ping not offered, no pong, no tool result reached the model',
      ].join('\n'),
    );
  });

  test('a top-level tool and a server still asleep when the result came back', () => {
    expect(
      describeToolTurns([
        { mode: 'exec', reading: { requests: 3, offered: 'tool', ponged: true }, awake: false },
      ]),
    ).toContain(
      'exec: ping offered as a tool, pong came back, server not running when the result came back',
    );
  });
});

describe('describeLaunches names both launches', () => {
  test('the second launch is the one judged', () => {
    expect(
      describeLaunches({
        first: [{ name: 'ovrdroid-fixture', pid: 200, processes: 1 }],
        second: [{ name: 'ovrdroid-fixture', pid: undefined, processes: 0 }],
      }),
    ).toBe(
      [
        'first launch, tools not cached yet:',
        '  ovrdroid-fixture: running, pid 200',
        'second launch, the one judged:',
        '  ovrdroid-fixture: not running (dormant)',
      ].join('\n'),
    );
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
