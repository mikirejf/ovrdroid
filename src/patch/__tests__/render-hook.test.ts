import { describe, expect, test } from 'bun:test';

import { SOURCE_CHARS } from '../render-profile-patches.ts';
import { payloadFunction } from './payload.ts';
import type { Fiber } from './render-fibers.ts';
import {
  CLASS,
  fiber,
  FORWARD_REF,
  FUNCTION,
  HOST,
  named,
  PERFORMED_WORK,
  root,
  SIMPLE_MEMO,
  withChildren,
} from './render-fibers.ts';
import type { HookState } from './render-walker.ts';
import { newWalker, updated } from './render-walker.ts';

type Row = [string, number, string, (readonly string[])?];

function walk(current: Fiber): Row[] {
  const walked = newWalker()(current);
  const names = new Map(walked.types.map(([id, name]) => [id, name]));
  return walked.renders.map(([id, selfMs, reason, keys]): Row => {
    const name = names.get(id) ?? 'undescribed';
    return keys === undefined || keys.length === 0
      ? [name, selfMs, reason]
      : [name, selfMs, reason, keys];
  });
}

function Real(): number {
  return 1;
}

function hook(state: HookState): HookState {
  return { next: null, ...state };
}

describe('the render walk', () => {
  test('a first commit records every component as a mount, with its own time', () => {
    const leaf = fiber(FUNCTION, named('Leaf'), { actualDuration: 2 });
    const box = withChildren(fiber(HOST, 'ink-box', { actualDuration: 3 }), [leaf]);
    const app = withChildren(fiber(FUNCTION, named('App'), { actualDuration: 10 }), [box]);

    expect(walk(root([app]))).toEqual([
      ['App', 7, 'mount'],
      ['Leaf', 2, 'mount'],
    ]);
  });

  test('a render with no changed props, state or context is put down to the parent', () => {
    const props = { label: 'same' };
    expect(
      walk(root([updated('Row', { memoizedProps: props }, { memoizedProps: { ...props } })])),
    ).toEqual([['Row', 0, 'parent']]);
  });

  test('changed props name the keys that changed', () => {
    const next = updated(
      'Row',
      { memoizedProps: { text: 'a', width: 3, gone: 1 } },
      { memoizedProps: { text: 'b', width: 3, fresh: 2 } },
    );
    expect(walk(root([next]))).toEqual([['Row', 0, 'props', ['text', 'gone', 'fresh']]]);
  });

  test('a changed useState or useSyncExternalStore hook is state, a changed useMemo is not', () => {
    const queue = { pending: null };
    const store = { value: 1, getSnapshot: () => 1 };
    const stateful = updated(
      'Input',
      {
        memoizedState: hook({
          memoizedState: [1],
          queue: null,
          next: hook({ memoizedState: 'a', queue }),
        }),
      },
      {
        memoizedState: hook({
          memoizedState: [2],
          queue: null,
          next: hook({ memoizedState: 'ab', queue }),
        }),
      },
    );
    const external = updated(
      'Footer',
      { memoizedState: hook({ memoizedState: 1, queue: store }) },
      { memoizedState: hook({ memoizedState: 2, queue: store }) },
    );
    const memoOnly = updated(
      'Label',
      { memoizedState: hook({ memoizedState: [1], queue: null }) },
      { memoizedState: hook({ memoizedState: [2], queue: null }) },
    );

    expect(walk(root([stateful, external, memoOnly]))).toEqual([
      ['Input', 0, 'state'],
      ['Footer', 0, 'state'],
      ['Label', 0, 'parent'],
    ]);
  });

  test('a changed context value is context, and props and state come with it when they changed too', () => {
    const theme = {};
    const next = updated(
      'Themed',
      {
        memoizedProps: { a: 1 },
        memoizedState: hook({ memoizedState: 1, queue: { pending: null } }),
        dependencies: { firstContext: { context: theme, memoizedValue: 'dark', next: null } },
      },
      {
        memoizedProps: { a: 2 },
        memoizedState: hook({ memoizedState: 2, queue: { pending: null } }),
        dependencies: { firstContext: { context: theme, memoizedValue: 'light', next: null } },
      },
    );
    expect(walk(root([next]))).toEqual([['Themed', 0, 'props+state+context', ['a']]]);
  });

  test('a class component compares its state object by key', () => {
    const Panel = named('Panel');
    const before = fiber(CLASS, Panel, { memoizedState: { open: false } });
    const after = fiber(CLASS, Panel, {
      alternate: before,
      flags: PERFORMED_WORK,
      memoizedState: { open: true },
    });
    expect(walk(root([after]))).toEqual([['Panel', 0, 'state']]);
  });

  test('a component that did not render is left out, but its children are still read', () => {
    const child = updated('Child', { memoizedProps: { n: 1 } }, { memoizedProps: { n: 2 } });
    const idle = withChildren(
      fiber(FUNCTION, named('Idle'), { alternate: fiber(FUNCTION, named('Idle')) }),
      [child],
    );
    expect(walk(root([idle]))).toEqual([['Child', 0, 'props', ['n']]]);
  });

  test('a subtree React skipped keeps its old children, and their stale flags are not read', () => {
    const stale = fiber(FUNCTION, named('Stale'), {
      flags: PERFORMED_WORK,
      alternate: fiber(FUNCTION, named('Stale')),
    });
    const before = withChildren(fiber(FUNCTION, named('Parent')), [stale]);
    const after = fiber(FUNCTION, named('Parent'), { alternate: before, child: stale });
    expect(walk(root([after]))).toEqual([]);
  });

  test('names come from displayName first, then the unwrapped function', () => {
    const shown = Object.assign(named('x'), { displayName: 'Shown' });
    const render = named('Inner');
    const memoType = named('m');
    const anonymous = named('');

    expect(
      walk(
        root([
          fiber(FUNCTION, shown),
          fiber(FORWARD_REF, { render }),
          fiber(SIMPLE_MEMO, memoType, {
            elementType: { displayName: 'MemoShown', type: memoType },
          }),
          fiber(FUNCTION, anonymous),
        ]),
      ).map(([name]) => name),
    ).toEqual(['Shown', 'Inner', 'MemoShown', 'Anonymous']);
  });
});

describe('component identity', () => {
  test('a type keeps its id across commits and is described only the first time', () => {
    const walker = newWalker();
    const first = walker(root([fiber(FUNCTION, Real)]));
    const before = fiber(FUNCTION, Real);
    const second = walker(
      root([fiber(FUNCTION, Real, { alternate: before, flags: PERFORMED_WORK })]),
    );

    expect(first.types).toEqual([[1, 'Real', Function.prototype.toString.call(Real)]]);
    expect(first.renders).toEqual([[1, 0, 'mount']]);
    expect(second.types).toEqual([]);
    expect(second.renders).toEqual([[1, 0, 'parent']]);
  });

  test('two functions with the same name get two ids', () => {
    const walked = newWalker()(root([fiber(FUNCTION, named('yc')), fiber(FUNCTION, named('yc'))]));
    expect(walked.types.map(([id, name]) => [id, name])).toEqual([
      [1, 'yc'],
      [2, 'yc'],
    ]);
  });

  test('a forwardRef and a memo are known by the function they wrap', () => {
    const walked = newWalker()(
      root([
        fiber(FUNCTION, Real),
        fiber(FORWARD_REF, { render: Real }),
        fiber(SIMPLE_MEMO, Real, { elementType: { type: Real } }),
      ]),
    );
    expect(walked.types).toHaveLength(1);
    expect(walked.renders.map(([id]) => id)).toEqual([1, 1, 1]);
  });

  test('every render comes with the name and source of its type, row for row', () => {
    const walker = newWalker();
    walker(root([fiber(FUNCTION, Real)]));
    const before = fiber(FUNCTION, Real);
    const second = walker(
      root([
        fiber(FUNCTION, Real, { alternate: before, flags: PERFORMED_WORK }),
        fiber(FUNCTION, named('Other')),
        fiber(FUNCTION, Real),
      ]),
    );

    expect(second.types.map(([, name]) => name)).toEqual(['Other']);
    expect(second.refs.map(([id, name]) => [id, name])).toEqual([
      [1, 'Real'],
      [2, 'Other'],
      [1, 'Real'],
    ]);
    expect(second.refs.map(([id]) => id)).toEqual(second.renders.map(([id]) => id));
    expect(second.refs[0]?.[2]).toBe(Function.prototype.toString.call(Real));
  });

  test('the described source is cut to a fixed length', () => {
    const long = payloadFunction<[], () => null>(
      [],
      `return function Long(){${' '.repeat(500)}return null}`,
    )();
    const [type] = newWalker()(root([fiber(FUNCTION, long)])).types;
    expect(type?.[2]).toHaveLength(SOURCE_CHARS);
    expect(type?.[2]).toStartWith('function Long(){');
  });
});
