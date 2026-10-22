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

interface StoreOptions {
  throwOnError: boolean;
  $ODcompact?: boolean;
}

type Mutator = (store: Store) => boolean;

type LockedWriteArgs = [string, string, unknown, unknown, Mutator, StoreOptions];

type LockedWrite = (...args: LockedWriteArgs) => Promise<void>;

type RunWriteArgs = [LockedWrite, string, string, unknown, unknown, Mutator, object];

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

const runWrite = payloadFunction<RunWriteArgs, Promise<void>>(
  ['Rd', 'o', 's', 'X', 'N', 't', 'e'],
  `return (async()=>${pruning.replace})()`,
);

function entry({ id, status, ageHours }: Aged): Invocation {
  return {
    taskInvocationId: id,
    status,
    createdAt: NOW - ageHours * HOUR,
    updatedAt: NOW - ageHours * HOUR,
  };
}

function withoutUpdatedAt(aged: Aged): Invocation {
  const { updatedAt: _dropped, ...rest } = entry(aged);
  return rest;
}

function noChange(_store: Store): boolean {
  return false;
}

async function writeThrough(
  invocations: Invocation[],
  mutate: Mutator = noChange,
): Promise<Written> {
  const store: Store = { invocations };
  let rewritten = false;
  let seen: StoreOptions | undefined;
  const lockedWrite: LockedWrite = async (...args) => {
    seen = args[5];
    rewritten = await Promise.resolve(args[4](store));
  };
  const realNow = Date.now;
  Date.now = () => NOW;
  try {
    await runWrite(lockedWrite, 'store.json', 'store.json.bak', 0, 0, mutate, {});
  } finally {
    Date.now = realNow;
  }
  if (seen === undefined) {
    throw new TypeError('the locked write was never called');
  }
  return { store, rewritten, options: seen };
}

function ids(store: Store): string[] {
  return store.invocations.map((invocation) => invocation.taskInvocationId);
}

describe('task store pruning', () => {
  test('drops finished entries older than 48 hours and keeps newer ones', async () => {
    const { store, rewritten } = await writeThrough([
      entry({ id: 'old-completed', status: 'completed', ageHours: 49 }),
      entry({ id: 'old-failed', status: 'failed', ageHours: 100 }),
      entry({ id: 'old-cancelled', status: 'cancelled', ageHours: 72 }),
      entry({ id: 'old-unknown', status: 'weird', ageHours: 72 }),
      entry({ id: 'fresh-completed', status: 'completed', ageHours: 47 }),
    ]);
    expect(ids(store)).toEqual(['fresh-completed']);
    expect(rewritten).toBe(true);
  });

  test('never drops running or pending entries, however old', async () => {
    const { store } = await writeThrough([
      entry({ id: 'stuck-running', status: 'running', ageHours: 300 }),
      entry({ id: 'stuck-pending', status: 'pending', ageHours: 300 }),
      entry({ id: 'old-completed', status: 'completed', ageHours: 300 }),
    ]);
    expect(ids(store)).toEqual(['stuck-running', 'stuck-pending']);
  });

  test('keeps an entry exactly at the age limit', async () => {
    const { store } = await writeThrough([
      entry({ id: 'edge', status: 'completed', ageHours: TASK_STORE_MAX_AGE_MS / HOUR }),
    ]);
    expect(ids(store)).toEqual(['edge']);
  });

  test('ages an entry without updatedAt by its createdAt', async () => {
    const { store } = await writeThrough([
      withoutUpdatedAt({ id: 'stale', status: 'completed', ageHours: 60 }),
      withoutUpdatedAt({ id: 'recent', status: 'completed', ageHours: 1 }),
    ]);
    expect(ids(store)).toEqual(['recent']);
  });

  test('leaves the store alone when nothing is old and the mutator changed nothing', async () => {
    const { store, rewritten } = await writeThrough([
      entry({ id: 'fresh', status: 'completed', ageHours: 1 }),
    ]);
    expect(ids(store)).toEqual(['fresh']);
    expect(rewritten).toBe(false);
  });

  test('still reports the mutator change when nothing is old', async () => {
    const { rewritten } = await writeThrough(
      [entry({ id: 'fresh', status: 'completed', ageHours: 1 })],
      () => true,
    );
    expect(rewritten).toBe(true);
  });

  test('lets the mutator see old entries before they are pruned', async () => {
    let sawOld = false;
    const { store } = await writeThrough(
      [entry({ id: 'old', status: 'completed', ageHours: 100 })],
      (draft) => {
        sawOld = draft.invocations.length === 1;
        return false;
      },
    );
    expect(sawOld).toBe(true);
    expect(store.invocations).toEqual([]);
  });

  test('keeps an entry the mutator just touched', async () => {
    const { store } = await writeThrough(
      [entry({ id: 'touched', status: 'completed', ageHours: 100 })],
      (draft) => {
        const [first] = draft.invocations;
        if (first !== undefined) {
          first.updatedAt = NOW;
        }
        return true;
      },
    );
    expect(ids(store)).toEqual(['touched']);
  });

  test('asks the locked write for compact output and keeps the stock options', async () => {
    const { options } = await writeThrough([]);
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
