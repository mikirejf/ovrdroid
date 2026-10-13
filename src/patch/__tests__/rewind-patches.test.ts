import { describe, expect, test } from 'bun:test';

import {
  KEPT_TOOL_CALLS,
  MOVE_TASKS,
  RETAG,
  REWIND_MOVE_GLOBAL,
  rewindPatches,
  SUBAGENT_TAG,
} from '../rewind-patches.ts';
import { describeStrayNames, payloadFunction } from './payload.ts';
import type { Globals, Invocation, Mover, Tag } from './rewind-fixtures.ts';
import { isActive, NEW, OLD, running } from './rewind-fixtures.ts';

interface Store {
  invocations: Invocation[];
}

type Mutator = (store: Store) => boolean;
type LockedWrite = (mutate: Mutator) => Promise<void>;
type InstallMoverArgs = [
  LockedWrite,
  (status: string) => boolean,
  (entry: Invocation) => Invocation,
  Globals,
];
type RetagArgs = [tags: Tag[], from: string, to: string];

const NEW_PATH = '/sessions/new-chat.jsonl';

const installMover = payloadFunction<InstallMoverArgs, undefined>(
  ['k', 'S', 'v', 'globalThis'],
  MOVE_TASKS,
);
const keptToolCalls = payloadFunction<[], (text: string) => Set<string>>(
  [],
  `${KEPT_TOOL_CALLS}return $ODkeptToolCalls`,
)();
const retag = payloadFunction<[], (...args: RetagArgs) => Tag[] | undefined>(
  [],
  `${RETAG}return $ODretag`,
)();

interface StoreRun {
  store: Store;
  writes: boolean[];
  mover: Mover;
}

function copyOf(entry: Invocation): Invocation {
  return { ...entry };
}

function moverOf(globals: Globals): Mover {
  const mover = globals.__odRewindMoveTasks;
  if (mover === undefined) {
    throw new TypeError('the payload did not install the mover');
  }
  return mover;
}

function storeWith(invocations: Invocation[], write?: LockedWrite): StoreRun {
  const store: Store = { invocations };
  const writes: boolean[] = [];
  const globals: Globals = {};
  const lockedWrite: LockedWrite =
    write ??
    (async (mutate) => {
      writes.push(await Promise.resolve(mutate(store)));
    });
  installMover(lockedWrite, isActive, copyOf, globals);
  expect(Object.keys(globals)).toEqual([REWIND_MOVE_GLOBAL]);
  return { store, writes, mover: moverOf(globals) };
}

function parents(store: Store): Record<string, string> {
  return Object.fromEntries(
    store.invocations.map((entry) => [entry.taskInvocationId, entry.parentSessionId]),
  );
}

describe('the task store moves running tasks to the rewound chat', () => {
  test('moves only running background tasks of the old chat whose call the rewind kept', async () => {
    const { store, mover } = storeWith([
      running('kept'),
      running('pending', { status: 'pending' }),
      running('cut'),
      running('done', { status: 'completed' }),
      running('foreground', { runInBackground: false }),
      running('other', { parentSessionId: 'other-chat' }),
    ]);
    const kept = new Set([
      'call-kept',
      'call-pending',
      'call-done',
      'call-foreground',
      'call-other',
    ]);

    const moved = await mover(OLD, NEW, kept, NEW_PATH);

    expect(moved.map((entry) => entry.taskInvocationId)).toEqual(['kept', 'pending']);
    expect(parents(store)).toEqual({
      kept: NEW,
      pending: NEW,
      cut: OLD,
      done: OLD,
      foreground: OLD,
      other: 'other-chat',
    });
    expect(store.invocations[0]?.parentTranscriptPath).toBe(NEW_PATH);
    expect(store.invocations[0]?.updatedAt).toBeNumber();
  });

  test('returns copies, so a caller cannot edit the store behind the lock', async () => {
    const { store, mover } = storeWith([running('kept')]);
    const [moved] = await mover(OLD, NEW, new Set(['call-kept']), NEW_PATH);
    expect(moved).not.toBe(store.invocations[0]);
    expect(moved?.parentSessionId).toBe(NEW);
  });

  test('tells the locked write nothing changed when no task moves', async () => {
    const { store, writes, mover } = storeWith([running('cut')]);
    expect(await mover(OLD, NEW, new Set(), NEW_PATH)).toEqual([]);
    expect(writes).toEqual([false]);
    expect(parents(store)).toEqual({ cut: OLD });
  });

  test('a retried mutator reports each task once', async () => {
    const invocations = [running('kept')];
    const { mover } = storeWith(invocations, async (mutate) => {
      mutate(structuredClone({ invocations }));
      await Promise.resolve(mutate({ invocations }));
    });
    const moved = await mover(OLD, NEW, new Set(['call-kept']), NEW_PATH);
    expect(moved.map((entry) => entry.taskInvocationId)).toEqual(['kept']);
  });
});

describe('the kept history', () => {
  test('collects every tool call id in the rewound transcript', () => {
    const transcript = [
      JSON.stringify({ type: 'session_start', id: NEW }),
      JSON.stringify({
        type: 'message',
        message: {
          role: 'assistant',
          content: [
            { type: 'text', text: 'launching' },
            { type: 'tool_use', id: 'call-a', name: 'Task', input: {} },
            { type: 'tool_use', id: 'call-b', name: 'Read', input: {} },
          ],
        },
      }),
      JSON.stringify({
        type: 'message',
        message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'call-a' }] },
      }),
      '{"type":"tool_use" broken',
      '',
    ].join('\n');

    expect([...keptToolCalls(transcript)]).toEqual(['call-a', 'call-b']);
  });

  test('is empty when the transcript holds no tool call', () => {
    expect(keptToolCalls(JSON.stringify({ type: 'session_start' })).size).toBe(0);
  });
});

describe('the child tag', () => {
  test('points the subagent tag at the new chat and keeps every other field', () => {
    const tags: Tag[] = [
      { name: 'other', metadata: { callingSessionId: OLD } },
      { name: SUBAGENT_TAG, metadata: { callingSessionId: OLD, callingToolUseId: 'call-a' } },
    ];
    expect(retag(tags, OLD, NEW)).toEqual([
      { name: 'other', metadata: { callingSessionId: OLD } },
      { name: SUBAGENT_TAG, metadata: { callingSessionId: NEW, callingToolUseId: 'call-a' } },
    ]);
  });

  test('changes nothing when the subagent tag names another chat', () => {
    const tags: Tag[] = [{ name: SUBAGENT_TAG, metadata: { callingSessionId: 'other-chat' } }];
    expect(retag(tags, OLD, NEW)).toBeUndefined();
    expect(retag([], OLD, NEW)).toBeUndefined();
  });
});

describeStrayNames(rewindPatches);
