import { describe, expect, test } from 'bun:test';

import { patchSource } from '../../binary/apply.ts';
import type { Rebase } from '../rebase.ts';
import { applies, rebaseAll } from '../rebase.ts';
import { todoRenderPatches } from '../todo-render-patches.ts';
import { sourceApp, STOCK } from './ink-frame-harness.ts';
import { patchNamed, payloadFunction, strayNames } from './payload.ts';

const SLOW_PATCH_MS = 120_000;

const rebases = rebaseAll(
  todoRenderPatches,
  (STOCK ?? []).map((module) => module.text),
);

function rebased(name: string): Rebase {
  const found = rebases.find((rebase) => rebase.name === name);
  if (found === undefined) {
    throw new Error(`${name} is missing from the todo render patches`);
  }
  return found;
}

describe('every name of three characters or fewer in a payload is captured or owned', () => {
  test.each(todoRenderPatches.map((patch) => [patch.name, patch] as const))(
    '%s',
    (_name, patch) => {
      expect(strayNames(patch)).toEqual([]);
    },
  );
});

describe.skipIf(STOCK === undefined)(
  'every todo render patch applies to the shipped bundle once',
  () => {
    test.each(todoRenderPatches.map((patch) => [patch.name] as const))('%s', (name) => {
      const rebase = rebased(name);
      expect(applies(rebase)).toBe(true);
      expect(rebase.matches).toBe(1);
    });

    test(
      'the patched chunk carries the helper and the memo',
      () => {
        const text = patchSource(sourceApp(), todoRenderPatches)
          .map((module) => module.text)
          .join('\n');
        expect(text).toContain('$ODkeepTodos');
        const memo = rebased('todo-panel-memo');
        const panel = memo.renames['eG'] ?? 'eG';
        const memoName = memo.renames['Bg'] ?? 'Bg';
        expect(text).toContain(`${panel}=${memoName}(${panel});function ${panel}({todos:`);
      },
      SLOW_PATCH_MS,
    );

    test('the panel gets only bare identifiers, so a shallow compare can hold', () => {
      const panel = rebased('todo-panel-memo').renames['eG'] ?? 'eG';
      const text = sourceApp()
        .map((module) => module.text)
        .join('\n');
      const sites = text.match(
        new RegExp(`[\\w$]+\\(${panel.replace('$', '\\$')},\\{[^{}]*\\}\\)`, 'gu'),
      );
      expect(sites).toHaveLength(1);
      expect(sites?.[0]).toMatch(
        /^[\w$]+\([\w$]+,\{todos:[\w$]+,width:[\w$]+,maxVisibleRows:[\w$]+\}\)$/u,
      );
    });
  },
);

interface Todo {
  id: string;
  status: string;
  content: string;
  priority?: string;
}

interface Output {
  todos: Todo[];
}

interface Store {
  version: number;
  todos: Todo[] | null;
}

type Stores = Map<string, Store>;

interface Ref {
  current: { lastVersion: number; lastOutput: Output | null };
}

type Snapshot = () => Output | null;

const HEAD =
  'function Vke(g,y){return()=>{if(!g)return null;' +
  'let v=P().getSessionStateManager().getSessionManager(g);if(!v)return null;' +
  'let E=v.getStore().getVersion(),A=y.current;if(A.lastVersion===E)return A.lastOutput;' +
  'let L=v.getStore().getMessages(),';

function copyTodo(todo: Todo): Todo {
  return { ...todo };
}

function normalize(todos: Todo[] | null): Output | null {
  return todos === null ? null : { todos: todos.map((todo) => copyTodo(todo)) };
}

function snapshotWith(tail: string, stores: Stores) {
  const sessions = {
    getSessionStateManager: () => ({
      getSessionManager: (id: string) => {
        const store = stores.get(id);
        return store === undefined
          ? undefined
          : {
              getStore: () => ({
                getVersion: () => store.version,
                getMessages: () => store.todos,
              }),
            };
      },
    }),
  };
  return payloadFunction<
    [() => typeof sessions, typeof normalize],
    (id: string | null, ref: Ref) => Snapshot
  >(['P', 'Wke'], `${HEAD}${tail}return Vke`)(() => sessions, normalize);
}

function freshRef(): Ref {
  return { current: { lastVersion: -1, lastOutput: null } };
}

const A: Todo = { id: '1', status: 'pending', content: 'write' };
const B: Todo = { id: '2', status: 'pending', content: 'test' };

function world(patched: boolean) {
  const patch = patchNamed(todoRenderPatches, 'todo-snapshot-stable');
  const stores: Stores = new Map([
    ['s1', { version: 1, todos: [A, B] }],
    ['s2', { version: 1, todos: [A, B] }],
  ]);
  const make = snapshotWith(patched ? patch.replace : patch.find, stores);
  return { stores, make };
}

describe('todo-snapshot-stable', () => {
  test('stock hands out a new object after an unrelated version bump', () => {
    const { stores, make } = world(false);
    const read = make('s1', freshRef());
    const first = read();
    stores.set('s1', { version: 2, todos: [A, B] });
    expect(read()).not.toBe(first);
    expect(read()).toEqual(first);
  });

  test('the same todos after an unrelated version bump are the same object', () => {
    const { stores, make } = world(true);
    const read = make('s1', freshRef());
    const first = read();
    stores.set('s1', { version: 2, todos: [A, B].map((todo) => copyTodo(todo)) });
    expect(read()).toBe(first);
    expect(read()).toBe(first);
  });

  test('the new version is recorded, so the next call does not read the store again', () => {
    const { stores, make } = world(true);
    const ref = freshRef();
    const read = make('s1', ref);
    read();
    stores.set('s1', { version: 5, todos: [A, B] });
    read();
    expect(ref.current.lastVersion).toBe(5);
  });

  test('a changed status is a new object', () => {
    const { stores, make } = world(true);
    const read = make('s1', freshRef());
    const first = read();
    stores.set('s1', { version: 2, todos: [{ ...A, status: 'completed' }, B] });
    const second = read();
    expect(second).not.toBe(first);
    expect(second?.todos[0]?.status).toBe('completed');
  });

  test('changed content, a changed id, a new field or a dropped field is a new object', () => {
    const { stores, make } = world(true);
    const read = make('s1', freshRef());
    let last = read();
    let version = 1;
    for (const todos of [
      [{ ...A, content: 'other' }, B],
      [{ ...A, id: '9' }, B],
      [{ ...A, priority: 'high' }, B],
      [{ ...A, priority: 'high', extra: 1 }, B],
      [A, B],
    ]) {
      version += 1;
      stores.set('s1', { version, todos });
      const next = read();
      expect(next).not.toBe(last);
      last = next;
    }
  });

  test('a todo added or removed is a new object', () => {
    const { stores, make } = world(true);
    const read = make('s1', freshRef());
    const first = read();
    stores.set('s1', {
      version: 2,
      todos: [A, B, { id: '3', status: 'pending', content: 'ship' }],
    });
    const added = read();
    expect(added).not.toBe(first);
    expect(added?.todos).toHaveLength(3);
    stores.set('s1', { version: 3, todos: [A] });
    const removed = read();
    expect(removed).not.toBe(added);
    expect(removed?.todos).toEqual([A]);
  });

  test('the same todos in another order are a new object', () => {
    const { stores, make } = world(true);
    const read = make('s1', freshRef());
    const first = read();
    stores.set('s1', { version: 2, todos: [B, A] });
    expect(read()).not.toBe(first);
  });

  test('no todos to todos and todos to no todos give the new value', () => {
    const { stores, make } = world(true);
    stores.set('s1', { version: 1, todos: null });
    const read = make('s1', freshRef());
    expect(read()).toBeNull();
    stores.set('s1', { version: 2, todos: [A] });
    const shown = read();
    expect(shown).toEqual({ todos: [A] });
    stores.set('s1', { version: 3, todos: null });
    expect(read()).toBeNull();
  });

  test('a fresh ref, as a session change makes one, does not reuse the other session output', () => {
    const { stores, make } = world(true);
    const first = make('s1', freshRef())();
    const second = make('s2', freshRef())();
    expect(second).toEqual(first);
    expect(second).not.toBe(first);
    stores.set('s2', { version: 1, todos: [B] });
    expect(make('s2', freshRef())()).toEqual({ todos: [B] });
  });

  test('no session gives no todos, as stock does', () => {
    const { make } = world(true);
    expect(make(null, freshRef())()).toBeNull();
    expect(make('missing', freshRef())()).toBeNull();
  });

  test('the same sequence of stores ends where stock ends', () => {
    const sequence: (Todo[] | null)[] = [
      [A, B],
      [A, B],
      [{ ...A, status: 'completed' }, B],
      [{ ...A, status: 'completed' }, B],
      null,
      [A],
    ];
    const stock = world(false);
    const patched = world(true);
    const readStock = stock.make('s1', freshRef());
    const readPatched = patched.make('s1', freshRef());
    for (const [index, todos] of sequence.entries()) {
      stock.stores.set('s1', { version: index + 2, todos });
      patched.stores.set('s1', { version: index + 2, todos });
      expect(readPatched()).toEqual(readStock());
    }
  });
});

type Panel = () => null;

describe('todo-panel-memo', () => {
  const patch = patchNamed(todoRenderPatches, 'todo-panel-memo');

  test('wraps the panel in the plain memo, with no custom compare', () => {
    expect(patch.replace).toBe(`eG=Bg(eG);${patch.find}`);
  });

  test('the panel that renders is the memo, and it wraps the original', () => {
    const wrapped: Panel[] = [];
    const memo = (component: Panel) => {
      wrapped.push(component);
      return { memo: component };
    };
    const panel = payloadFunction<[typeof memo], unknown>(
      ['Bg'],
      `${patch.replace}}return eG`,
    )(memo);
    expect(wrapped).toHaveLength(1);
    expect(panel).toEqual({ memo: wrapped[0] });
    expect(wrapped[0]).toBeInstanceOf(Function);
  });
});
