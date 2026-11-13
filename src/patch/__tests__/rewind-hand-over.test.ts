import { describe, expect, test } from 'bun:test';

import { ATTACH_MOVED_TASK, rewindPatches, SUBAGENT_TAG } from '../rewind-patches.ts';
import { patchNamed, payloadFunction } from './payload.ts';
import type { Globals, Invocation, MoveArgs, Tag } from './rewind-fixtures.ts';
import { isActive, NEW, OLD, running } from './rewind-fixtures.ts';

interface Tracked {
  parentSessionId: string;
  childSessionId: string;
  parentToolUseId: string;
  taskInvocationId: string;
  deliveryEligible: boolean;
}

interface SettingsUpdate {
  sessionId: string;
  tags: Tag[];
}

interface SessionStore {
  setCallingSessionId: (to: string) => void;
}

interface Client {
  getSessionStateManager: () => {
    getSessionManager: (child: string) => { getStore: () => SessionStore };
  };
  updateSessionSettings: (update: SettingsUpdate) => Promise<void>;
}

interface Fs {
  readFileSync: (file: string) => string;
  existsSync: (file: string) => boolean;
}

type HandOverArgs = [
  {
    getSessionTranscriptPath: (id: string) => string;
    forkSession: () => Promise<string>;
  },
  () => Client,
  () => { trackBackgroundChild: (entry: Tracked) => void },
  (error: Error, message: string) => void,
  string,
  () => Fs,
  Globals,
];

const forkPatch = patchNamed(rewindPatches, 'rewind-hands-running-tasks-to-new-session');
const runHandOver = payloadFunction<HandOverArgs, Promise<string>>(
  ['c', 'N', 'hT', 'h', 'l', 'require', 'globalThis'],
  'return (async()=>{let a="title",t="message",m6="rewind",Aye="source";' +
    `let ${forkPatch.replace}$ODrestored=await Promise.resolve(S);return $ODrestored})()`,
);

interface HandOverWorld {
  moved: Invocation[];
  files: Record<string, string>;
  failMove?: boolean;
}

interface HandOverLog {
  moveArgs: MoveArgs | undefined;
  tracked: Tracked[];
  storeParents: Record<string, string>;
  settings: SettingsUpdate[];
  errors: string[];
}

function pathOf(id: string): string {
  return `/sessions/${id}.jsonl`;
}

function clientFor(log: HandOverLog): Client {
  return {
    getSessionStateManager: () => ({
      getSessionManager: (child: string) => ({
        getStore: () => ({
          setCallingSessionId: (to: string) => {
            log.storeParents[child] = to;
          },
        }),
      }),
    }),
    updateSessionSettings: async (update: SettingsUpdate) => {
      log.settings.push(update);
      await Promise.resolve();
    },
  };
}

async function handOver(world: HandOverWorld): Promise<HandOverLog> {
  const log: HandOverLog = {
    moveArgs: undefined,
    tracked: [],
    storeParents: {},
    settings: [],
    errors: [],
  };
  const globals: Globals = {
    __odRewindMoveTasks: async (...args: MoveArgs) => {
      log.moveArgs = args;
      if (world.failMove === true) {
        throw new Error('store locked');
      }
      return await Promise.resolve(world.moved);
    },
  };
  const fs: Fs = {
    readFileSync: (file) => world.files[file] ?? '',
    existsSync: (file) => file in world.files,
  };
  const rewound = await runHandOver(
    {
      getSessionTranscriptPath: pathOf,
      forkSession: async () => await Promise.resolve(NEW),
    },
    () => clientFor(log),
    () => ({
      trackBackgroundChild: (entry) => {
        log.tracked.push(entry);
      },
    }),
    (error, message) => {
      log.errors.push(`${message}: ${error.message}`);
    },
    OLD,
    () => fs,
    globals,
  );
  expect(rewound).toBe(NEW);
  return log;
}

function childTag(parent: string): Tag {
  return {
    name: SUBAGENT_TAG,
    metadata: { callingSessionId: parent, callingToolUseId: 'call-kept' },
  };
}

describe('the hand-over at rewind', () => {
  const callLine = JSON.stringify({
    type: 'message',
    message: { role: 'assistant', content: [{ type: 'tool_use', id: 'call-kept' }] },
  });

  test('moves the store, re-tracks the child, and updates its tags through the session API', async () => {
    const log = await handOver({
      moved: [running('kept', { parentSessionId: NEW })],
      files: {
        [pathOf(NEW)]: callLine,
        '/sessions/child-kept.settings.json': JSON.stringify({ tags: [childTag(OLD)] }),
      },
    });

    expect(log.moveArgs).toEqual([OLD, NEW, new Set(['call-kept']), pathOf(NEW)]);
    expect(log.tracked).toEqual([
      {
        parentSessionId: NEW,
        childSessionId: 'child-kept',
        parentToolUseId: 'call-kept',
        taskInvocationId: 'kept',
        deliveryEligible: true,
      },
    ]);
    expect(log.storeParents).toEqual({ 'child-kept': NEW });
    expect(log.settings).toEqual([{ sessionId: 'child-kept', tags: [childTag(NEW)] }]);
    expect(log.errors).toEqual([]);
  });

  test('skips the settings update when the child has no settings file yet', async () => {
    const log = await handOver({
      moved: [running('kept', { parentSessionId: NEW })],
      files: { [pathOf(NEW)]: callLine },
    });
    expect(log.tracked).toHaveLength(1);
    expect(log.settings).toEqual([]);
  });

  test('logs a failure instead of failing the rewind', async () => {
    const log = await handOver({ moved: [], files: { [pathOf(NEW)]: '' }, failMove: true });
    expect(log.errors).toEqual([
      '[ovrdroid] Failed to hand running tasks to the rewound session: store locked',
    ]);
  });
});

interface LiveTask {
  taskId: string;
}

interface StateManager {
  sessions: readonly string[];
}

interface Controller {
  loadSession: (request: { sessionId: string }) => Promise<void>;
}

type AttachArgs = [
  LiveTask | undefined,
  (id: string) => Invocation | undefined,
  { sessionId: string },
  (status: string) => boolean,
  { adapter: { ensureConnectedAndGetController: () => Promise<Controller> } },
  (manager: StateManager, id: string) => LiveTask | undefined,
  StateManager,
  string,
];

interface Lookup {
  w: LiveTask | undefined;
  b: Invocation | undefined;
}

const runAttach = payloadFunction<AttachArgs, Promise<Lookup>>(
  ['S', 'lr', 't', 'Ua', 'u', '$w', 'p', 'g'],
  `return (async()=>{${ATTACH_MOVED_TASK}return{w:S,b:S?void 0:lr(g)}})()`,
);

interface Attach {
  record: Invocation | undefined;
  machineId?: string;
  loadFails?: boolean;
  alreadyLive?: boolean;
}

interface Attached extends Lookup {
  loaded: string[];
}

async function attach({
  record,
  machineId,
  loadFails = false,
  alreadyLive = false,
}: Attach): Promise<Attached> {
  const loaded: string[] = [];
  const controller: Controller = {
    loadSession: async ({ sessionId }) => {
      if (loadFails) {
        throw new Error('gone');
      }
      loaded.push(sessionId);
      await Promise.resolve();
    },
  };
  const client = {
    adapter: { ensureConnectedAndGetController: async () => await Promise.resolve(controller) },
  };
  const live = (_manager: StateManager, id: string) =>
    loaded.includes(id) ? { taskId: id } : undefined;
  const found = await runAttach(
    alreadyLive ? { taskId: 'child-kept' } : undefined,
    () => (record === undefined ? undefined : { ...record, machineId }),
    { sessionId: NEW },
    isActive,
    client,
    live,
    { sessions: [] },
    'child-kept',
  );
  return { ...found, loaded };
}

describe('TaskOutput finds a moved running task', () => {
  test('attaches the child of a running background task this chat now owns', async () => {
    const result = await attach({ record: running('kept', { parentSessionId: NEW }) });
    expect(result).toEqual({ w: { taskId: 'child-kept' }, b: undefined, loaded: ['child-kept'] });
  });

  test('leaves tasks of another chat, remote tasks and finished tasks to the stock lookup', async () => {
    const owned = { parentSessionId: NEW };
    const other = await attach({ record: running('kept') });
    const remote = await attach({ record: running('kept', owned), machineId: 'mac' });
    const finished = await attach({ record: running('kept', { ...owned, status: 'completed' }) });
    expect([other.loaded, remote.loaded, finished.loaded]).toEqual([[], [], []]);
    expect(other.w).toBeUndefined();
  });

  test('falls back to the stock not-found answer when the child cannot load', async () => {
    const result = await attach({
      record: running('kept', { parentSessionId: NEW }),
      loadFails: true,
    });
    expect(result.w).toBeUndefined();
    expect(result.b).toBeDefined();
  });

  test('attaches a pending task but leaves foreground and missing tasks alone', async () => {
    const owned = { parentSessionId: NEW };
    const pending = await attach({
      record: running('kept', { ...owned, status: 'pending' }),
    });
    const foreground = await attach({
      record: running('kept', { ...owned, runInBackground: false }),
    });
    const missing = await attach({ record: undefined });
    expect(pending.loaded).toEqual(['child-kept']);
    expect([foreground.loaded, missing.loaded]).toEqual([[], []]);
  });

  test('does not reload a task the session state already knows', async () => {
    const result = await attach({
      record: running('kept', { parentSessionId: NEW }),
      alreadyLive: true,
    });
    expect(result.w).toEqual({ taskId: 'child-kept' });
    expect(result.loaded).toEqual([]);
  });
});
