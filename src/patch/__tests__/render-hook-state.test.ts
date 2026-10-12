import { describe, expect, test } from 'bun:test';

import { HOOK_CHARS, MESSAGES_HOOK, STATE_HOOK, STORE_HOOK } from '../render-profile-patches.ts';
import { payloadFunction } from './payload.ts';
import type { Fiber } from './render-fibers.ts';
import { fiber, FUNCTION, named, PERFORMED_WORK, root } from './render-fibers.ts';
import type { Explain, HookState, Walked } from './render-walker.ts';
import { newWalker, updated } from './render-walker.ts';

type Snapshot = number | string | readonly object[] | null;

interface StoreQueue {
  value: null;
  getSnapshot: () => Snapshot;
}

function hooks(...states: readonly HookState[]): HookState | null {
  let next: HookState | null = null;
  for (const state of states.toReversed()) {
    next = { ...state, next };
  }
  return next;
}

function storeReading(snapshot: () => Snapshot): StoreQueue {
  return { value: null, getSnapshot: snapshot };
}

function rootWith(previous: HookState | null, next: HookState | null): Fiber {
  return updated('Root', { memoizedState: previous }, { memoizedState: next });
}

function snapshotText(): string {
  return 'snapshot';
}

describe('which state hooks changed', () => {
  const queue = { pending: null };
  const memo = { memoizedState: [1], queue: null };

  test('a state render names each changed hook by its place in the hook list', () => {
    const read = storeReading(() => 1);
    const walked = newWalker()(
      root([
        rootWith(
          hooks(memo, { memoizedState: { open: false }, queue }, { memoizedState: 1, queue: read }),
          hooks(memo, { memoizedState: { open: true }, queue }, { memoizedState: 2, queue: read }),
        ),
      ]),
    );
    expect(walked.renders).toEqual([[1, 0, 'state', [], [1, 2]]]);
  });

  test('each changed hook is described once, by its kind and what it holds or reads', () => {
    const read = storeReading(snapshotText);
    const type = named('Root');
    const walker = newWalker();
    const commitWith = (open: boolean, value: number): Walked =>
      walker(
        root([
          fiber(FUNCTION, type, {
            flags: PERFORMED_WORK,
            alternate: fiber(FUNCTION, type, {
              memoizedState: hooks(
                { memoizedState: { open: !open, width: 3 }, queue },
                { memoizedState: value - 1, queue: read },
              ),
            }),
            memoizedState: hooks(
              { memoizedState: { open, width: 3 }, queue },
              { memoizedState: value, queue: read },
            ),
          }),
        ]),
      );

    expect(commitWith(true, 1).hookTypes).toEqual([
      [1, 0, STATE_HOOK, 'object {open,width}'],
      [1, 1, STORE_HOOK, Function.prototype.toString.call(snapshotText)],
    ]);
    expect(commitWith(false, 2).hookTypes).toEqual([]);
  });

  test('a store reader is described by the start of its getSnapshot source', () => {
    const long = payloadFunction<[], () => null>(
      [],
      `return function read(){${' '.repeat(500)}return null}`,
    )();
    const read = storeReading(long);
    const [described] = newWalker()(
      root([
        rootWith(
          hooks({ memoizedState: 1, queue: read }),
          hooks({ memoizedState: 2, queue: read }),
        ),
      ]),
    ).hookTypes;
    expect(described?.[3]).toHaveLength(HOOK_CHARS);
  });

  test('a hook holding a message snapshot carries what changed it and is described as the message snapshot', () => {
    const before = [{ id: 'a' }];
    const after = [{ id: 'a' }];
    const read = storeReading(() => after);
    const explain: Explain = (previous, next) =>
      previous === before && next === after ? ['metadata_updated', 1] : undefined;
    const walked = newWalker(explain)(
      root([
        rootWith(
          hooks({ memoizedState: 1, queue }, { memoizedState: before, queue: read }),
          hooks({ memoizedState: 2, queue }, { memoizedState: after, queue: read }),
        ),
      ]),
    );
    expect(walked.renders).toEqual([[1, 0, 'state', [], [0, 1], ['metadata_updated', 1]]]);
    expect(walked.hookTypes.map(([, index, kind]) => [index, kind])).toEqual([
      [0, STATE_HOOK],
      [1, MESSAGES_HOOK],
    ]);
  });

  test('changed props ride along with the hooks', () => {
    const walked = newWalker()(
      root([
        updated(
          'Row',
          { memoizedProps: { a: 1 }, memoizedState: hooks({ memoizedState: 'x', queue }) },
          { memoizedProps: { a: 2 }, memoizedState: hooks({ memoizedState: 'y', queue }) },
        ),
      ]),
    );
    expect(walked.renders).toEqual([[1, 0, 'props+state', ['a'], [0]]]);
    expect(walked.hookTypes).toEqual([[1, 0, STATE_HOOK, 'string']]);
  });
});
