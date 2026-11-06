import { describe, expect, test } from 'bun:test';

import { TASK_STORE_MAX_AGE_MS, taskStorePatches } from '../task-store-patches.ts';
import { patchNamed, payloadFunction } from './payload.ts';

interface Invocation {
  taskInvocationId: string;
  status: string;
  createdAt: number;
  updatedAt?: number;
}

interface Store {
  invocations: Invocation[];
}

interface View {
  invocations: Invocation[];
  rows: Invocation[];
}

interface StoreOptions {
  throwOnError: boolean;
  $ODcompact?: boolean;
}

type Mutator = (view: View) => boolean;

type ReadView = (store: Store) => View;

type MergeView = (view: View) => Invocation[];

type BuildWrite = (
  readView: ReadView,
  mergeView: MergeView,
  mutate: Mutator,
) => [(store: Store) => boolean, StoreOptions];

interface Written {
  store: Store;
  rewritten: boolean;
  options: StoreOptions;
}

interface Aged {
  id: string;
  status: string;
  ageHours: number;
}

const pruning = patchNamed(taskStorePatches, 'task-store-prunes-old-invocations');
const compact = patchNamed(taskStorePatches, 'task-store-writes-compact-json');

const NOW = Date.UTC(2026, 9, 10);
const HOUR = 60 * 60 * 1000;

const buildWrite = payloadFunction<Parameters<BuildWrite>, ReturnType<BuildWrite>>(
  ['xe', 'at', 'e'],
  `return [${pruning.replace}}]`,
);

function readable(row: Invocation): boolean {
  return typeof row.createdAt === 'number' && typeof row.updatedAt === 'number';
}

function readView(store: Store): View {
  return { invocations: store.invocations.filter(readable), rows: store.invocations };
}

function mergeView({ invocations, rows }: View): Invocation[] {
  const kept = new Set(invocations);
  const known = new Set(rows);
  return [
    ...rows.filter((row) => kept.has(row) || !readable(row)),
    ...invocations.filter((row) => !known.has(row)),
  ];
}

function entry({ id, status, ageHours }: Aged): Invocation {
  return {
    taskInvocationId: id,
    status,
    createdAt: NOW - ageHours * HOUR,
    updatedAt: NOW - ageHours * HOUR,
  };
}

function unreadable(aged: Aged): Invocation {
  const { updatedAt: _dropped, ...rest } = entry(aged);
  return rest;
}

function noChange(_view: View): boolean {
  return false;
}

function writeThrough(invocations: Invocation[], mutate: Mutator = noChange): Written {
  const store: Store = { invocations };
  const [write, options] = buildWrite(readView, mergeView, mutate);
  const realNow = Date.now;
  Date.now = () => NOW;
  try {
    return { store, rewritten: write(store), options };
  } finally {
    Date.now = realNow;
  }
}

function ids(store: Store): string[] {
  return store.invocations.map((invocation) => invocation.taskInvocationId);
}

describe('task store pruning', () => {
  test('drops finished entries older than 48 hours and keeps newer ones', () => {
    const { store, rewritten } = writeThrough([
      entry({ id: 'old-completed', status: 'completed', ageHours: 49 }),
      entry({ id: 'old-failed', status: 'failed', ageHours: 100 }),
      entry({ id: 'old-cancelled', status: 'cancelled', ageHours: 72 }),
      entry({ id: 'old-unknown', status: 'weird', ageHours: 72 }),
      entry({ id: 'fresh-completed', status: 'completed', ageHours: 47 }),
    ]);
    expect(ids(store)).toEqual(['fresh-completed']);
    expect(rewritten).toBe(true);
  });

  test('never drops running or pending entries, however old', () => {
    const { store } = writeThrough([
      entry({ id: 'stuck-running', status: 'running', ageHours: 300 }),
      entry({ id: 'stuck-pending', status: 'pending', ageHours: 300 }),
      entry({ id: 'old-completed', status: 'completed', ageHours: 300 }),
    ]);
    expect(ids(store)).toEqual(['stuck-running', 'stuck-pending']);
  });

  test('keeps an entry exactly at the age limit', () => {
    const { store } = writeThrough([
      entry({ id: 'edge', status: 'completed', ageHours: TASK_STORE_MAX_AGE_MS / HOUR }),
    ]);
    expect(ids(store)).toEqual(['edge']);
  });

  test('keeps rows this version cannot read, however old', () => {
    const { store } = writeThrough([
      unreadable({ id: 'foreign', status: 'completed', ageHours: 300 }),
      entry({ id: 'old', status: 'completed', ageHours: 300 }),
    ]);
    expect(ids(store)).toEqual(['foreign']);
  });

  test('leaves the store alone when nothing is old and the mutator changed nothing', () => {
    const { store, rewritten } = writeThrough([
      entry({ id: 'fresh', status: 'completed', ageHours: 1 }),
    ]);
    expect(ids(store)).toEqual(['fresh']);
    expect(rewritten).toBe(false);
  });

  test('still reports the mutator change when nothing is old', () => {
    const { rewritten } = writeThrough(
      [entry({ id: 'fresh', status: 'completed', ageHours: 1 })],
      () => true,
    );
    expect(rewritten).toBe(true);
  });

  test('keeps an entry the mutator adds', () => {
    const { store } = writeThrough(
      [entry({ id: 'old', status: 'completed', ageHours: 100 })],
      (view) => {
        view.invocations.push(entry({ id: 'new', status: 'running', ageHours: 0 }));
        return true;
      },
    );
    expect(ids(store)).toEqual(['new']);
  });

  test('lets the mutator see old entries before they are pruned', () => {
    let sawOld = false;
    const { store } = writeThrough(
      [entry({ id: 'old', status: 'completed', ageHours: 100 })],
      (view) => {
        sawOld = view.invocations.length === 1;
        return false;
      },
    );
    expect(sawOld).toBe(true);
    expect(store.invocations).toEqual([]);
  });

  test('keeps an entry the mutator just touched', () => {
    const { store } = writeThrough(
      [entry({ id: 'touched', status: 'completed', ageHours: 100 })],
      (view) => {
        const [first] = view.invocations;
        if (first !== undefined) {
          first.updatedAt = NOW;
        }
        return true;
      },
    );
    expect(ids(store)).toEqual(['touched']);
  });

  test('asks the locked write for compact output and keeps the stock options', () => {
    const { options } = writeThrough([]);
    expect(options.$ODcompact).toBe(true);
    expect(options.throwOnError).toBe(true);
  });
});
type SerializeStoreArgs = [string, string, Store, StoreOptions | null];

type SerializeStore = (...args: SerializeStoreArgs) => string;

const STOCK_TAIL = ';return c}catch(l){throw l}}';

const buildSerializer = payloadFunction<[], SerializeStore>(
  [],
  `${compact.replace}${STOCK_TAIL};return jo`,
);

function writeWith(options: StoreOptions | null): string {
  return buildSerializer()(
    'store.json',
    'store.json.bak',
    { invocations: [entry({ id: 'a', status: 'completed', ageHours: 1 })] },
    options,
  );
}

const ONE_ENTRY = { invocations: [entry({ id: 'a', status: 'completed', ageHours: 1 })] };

describe('task store compact output', () => {
  test('writes one line of JSON when asked', () => {
    const data = writeWith({ throwOnError: true, $ODcompact: true });
    expect(data).not.toContain('\n');
    expect(JSON.parse(data)).toEqual(ONE_ENTRY);
  });

  test('keeps the two-space indent for every other store', () => {
    expect(writeWith({ throwOnError: true })).toBe(JSON.stringify(ONE_ENTRY, null, 2));
  });

  test('keeps the two-space indent when a store passes no options', () => {
    expect(writeWith(null)).toBe(JSON.stringify(ONE_ENTRY, null, 2));
  });
});
