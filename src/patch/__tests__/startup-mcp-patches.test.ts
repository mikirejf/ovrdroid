import { describe, expect, test } from 'bun:test';

import { patchSource } from '../../binary/apply.ts';
import { patches } from '../patches.ts';
import { rebaseAll } from '../rebase.ts';
import { blockEnd } from '../tokens.ts';
import { describeStrayNames, patchNamed, payloadFunction, rebasedNamed } from './payload.ts';
import { requireStock, stockDroid } from './stock-scanner.ts';

const NAMES = [
  'gate-first-turn-on-ide-connect',
  'session-worker-starts-mcp-in-background',
] as const;
const selected = NAMES.map((name) => patchNamed(patches, name));

function site(name: string) {
  const app = requireStock();
  const list = [patchNamed(selected, name)];
  const rebase = rebasedNamed(
    rebaseAll(
      list,
      app.map((module) => module.text),
    ),
    name,
  );
  const module = patchSource(app, list).find((entry) => entry.text.includes(rebase.replace));
  if (module === undefined) {
    throw new Error(`no patched module carries ${name}`);
  }
  return { rebase, text: module.text };
}

interface Gate {
  awaitMcpReadinessBeforeAgentTurnIfEnabled: (turn: string, request?: string) => Promise<void>;
}

interface TimerHandle {
  unref: () => void;
}

function gateWorld(ide: Promise<null> | null, block: boolean) {
  const { rebase, text } = site(NAMES[0]);
  const at = text.indexOf(rebase.replace);
  const start = text.lastIndexOf('async awaitMcpReadinessBeforeAgentTurnIfEnabled(', at);
  const open = text.indexOf('{', start);
  const method = text.slice(start, blockEnd(text, open) + 1);
  const bindings =
    /await (?<phase>[\w$]+)\(\{step:"mcp_readiness",run:async\(\)=>(?<outcome>[\w$]+)\(/u.exec(
      method,
    )?.groups;
  if (bindings?.['phase'] === undefined || bindings['outcome'] === undefined) {
    throw new Error('the stock readiness phase instrumentation changed');
  }
  const events: string[] = [];
  const timers: { run: () => void; ms: number; unrefed: boolean }[] = [];
  const cleared: TimerHandle[] = [];
  const setTimer = (run: () => void, ms: number): TimerHandle => {
    const timer = { run, ms, unrefed: false };
    timers.push(timer);
    return {
      unref: () => {
        timer.unrefed = true;
      },
    };
  };
  const phase = async (options: {
    step: string;
    run: () => Promise<string>;
    labelsOf: (outcome: string) => { turnId: string };
  }) => {
    events.push(options.step);
    const result = await options.run();
    events.push(options.labelsOf(result).turnId);
  };
  const gate = payloadFunction<
    [typeof phase, (value: string) => string, typeof setTimer, (timer: TimerHandle) => void],
    Gate
  >([bindings['phase'], bindings['outcome'], 'setTimeout', 'clearTimeout'], `return {${method}}`)(
    phase,
    (value) => value,
    setTimer,
    (timer) => {
      cleared.push(timer);
    },
  );
  Object.assign(gate, {
    ideInitPromise: ide,
    refreshMcpListeners: () => events.push('refresh'),
    isBlockOnStartupLoadEnabled: () => block,
    sessionController: { getSessionId: () => 'session' },
    awaitMcpReadinessBeforeAgentTurn: async (turn: string, request: string) => {
      events.push(`${turn}:${request}`);
      return await Promise.resolve('ready');
    },
  });
  return { gate, events, timers, cleared };
}

interface WorkerOptions {
  inputFormat?: string;
  listTools?: boolean;
  enabledTools?: string[];
  additionalTools?: string[];
  disabledTools?: string[];
  restrictTools?: string[];
  onlyTools?: string[];
  addTools?: string[];
  removeTools?: string[];
}

interface WorkerDeps {
  blockOnStartupLoad: boolean;
  startMcp: () => Promise<void>;
  waitForSettle: () => Promise<void>;
  startBackgroundTask: (phase: string, run: () => Promise<void>) => void;
  runBlockingPhase: (phase: string, run: () => Promise<void>) => Promise<void>;
}

function workerWorld() {
  const { rebase, text } = site(NAMES[1]);
  const named = (name: string) => rebase.renames[name] ?? name;
  const at = text.indexOf(rebase.replace);
  const start = text.lastIndexOf('async function ', at);
  const open = text.indexOf('){', start) + 1;
  const body = text.slice(open, blockEnd(text, open) + 1);
  const predicateStart = text.indexOf(`function ${named('Zi')}(`);
  const predicateOpen = text.indexOf('{', predicateStart);
  const predicate = text.slice(predicateStart, blockEnd(text, predicateOpen) + 1);
  const run = payloadFunction<[], (options: WorkerOptions, deps: WorkerDeps) => Promise<void>>(
    [],
    `${predicate};return async(${named('e')},${named('t')})=>${body}`,
  )();
  return async (options: WorkerOptions, block: boolean) => {
    const events: string[] = [];
    const startMcp = async () => {
      events.push('start');
      await Promise.resolve();
    };
    await run(options, {
      blockOnStartupLoad: block,
      startMcp,
      waitForSettle: async () => {
        events.push('settled');
        await Promise.resolve();
      },
      startBackgroundTask: (phase, task) => {
        expect(task).toBe(startMcp);
        events.push(`background:${phase}`);
      },
      runBlockingPhase: async (phase, task) => {
        events.push(`blocking:${phase}`);
        await task();
      },
    });
    return events;
  };
}

describeStrayNames(selected);

describe.skipIf(stockDroid === undefined)('gate-first-turn-on-ide-connect', () => {
  test('waits for IDE connection before the MCP gate, retaining stock phase instrumentation', async () => {
    const ide = Promise.withResolvers<null>();
    const world = gateWorld(ide.promise, true);
    const result = world.gate.awaitMcpReadinessBeforeAgentTurnIfEnabled('turn', 'request');
    expect(world.events).toEqual(['refresh']);
    expect(world.timers.map(({ ms, unrefed }) => [ms, unrefed])).toEqual([[5000, true]]);
    ide.resolve(null);
    await result;
    expect(world.events).toEqual(['refresh', 'mcp_readiness', 'turn:request', 'turn']);
    expect(world.cleared).toHaveLength(1);
  });

  test('still waits for IDE when MCP blocking is disabled', async () => {
    const ide = Promise.withResolvers<null>();
    const world = gateWorld(ide.promise, false);
    let done = false;
    const result = (async () => {
      await world.gate.awaitMcpReadinessBeforeAgentTurnIfEnabled('turn');
      done = true;
    })();
    await Bun.sleep(0);
    expect(done).toBe(false);
    ide.resolve(null);
    await result;
    expect(done).toBe(true);
    expect(world.events).toEqual(['refresh']);
  });

  test('an IDE failure does not reject the turn', async () => {
    const world = gateWorld(Promise.reject(new Error('IDE disconnected')), true);
    await world.gate.awaitMcpReadinessBeforeAgentTurnIfEnabled('turn');
    expect(world.events).toEqual(['refresh', 'mcp_readiness', 'turn:turn', 'turn']);
    expect(world.cleared).toHaveLength(1);
  });

  test('the five-second bound releases an unresponsive IDE connection', async () => {
    const ide = Promise.withResolvers<null>();
    const world = gateWorld(ide.promise, true);
    const result = world.gate.awaitMcpReadinessBeforeAgentTurnIfEnabled('turn');
    expect(world.events).toEqual(['refresh']);
    expect(world.timers).toHaveLength(1);
    world.timers[0]?.run();
    await result;
    expect(world.events).toEqual(['refresh', 'mcp_readiness', 'turn:turn', 'turn']);
    expect(world.cleared).toHaveLength(1);
    ide.resolve(null);
  });

  test('without IDE initialization it proceeds without creating a timer', async () => {
    const world = gateWorld(null, true);
    await world.gate.awaitMcpReadinessBeforeAgentTurnIfEnabled('turn');
    expect(world.events).toEqual(['refresh', 'mcp_readiness', 'turn:turn', 'turn']);
    expect(world.timers).toEqual([]);
    expect(world.cleared).toEqual([]);
  });
});

describe.skipIf(stockDroid === undefined)('session-worker-starts-mcp-in-background', () => {
  test('JSON-RPC startup backgrounds MCP even when startup blocking is enabled', async () => {
    const run = workerWorld();
    expect(await run({ inputFormat: 'stream-jsonrpc' }, true)).toEqual(['background:mcp_init']);
    expect(await run({ inputFormat: 'stream-jsonrpc' }, false)).toEqual(['background:mcp_init']);
  });

  test('other modes retain the startup-blocking setting', async () => {
    const run = workerWorld();
    expect(await run({}, true)).toEqual(['blocking:mcp_init', 'start', 'settled']);
    expect(await run({}, false)).toEqual(['background:mcp_init']);
    expect(await run({ inputFormat: 'stream-json' }, false)).toEqual([
      'blocking:mcp_init',
      'start',
      'settled',
    ]);
  });

  test('tool enumeration still blocks for JSON-RPC workers', async () => {
    const run = workerWorld();
    expect(await run({ inputFormat: 'stream-jsonrpc', listTools: true }, true)).toEqual([
      'blocking:mcp_init',
      'start',
      'settled',
    ]);
  });

  test.each([
    'enabledTools',
    'additionalTools',
    'disabledTools',
    'restrictTools',
    'onlyTools',
    'addTools',
    'removeTools',
  ])('%s validation still waits for MCP tools', async (key) => {
    const run = workerWorld();
    expect(await run({ inputFormat: 'stream-jsonrpc', [key]: ['MCP:fixture'] }, true)).toEqual([
      'blocking:mcp_init',
      'start',
      'settled',
    ]);
  });
});
