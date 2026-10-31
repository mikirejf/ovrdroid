import { afterEach, describe, expect, test } from 'bun:test';

import { patchSource } from '../../binary/apply.ts';
import { patches } from '../patches.ts';
import { applies, rebaseAll } from '../rebase.ts';
import { recorderFeedPatches } from '../render-profile-patches.ts';
import { snapshotRenderPatches } from '../snapshot-render-patches.ts';
import { sourceApp, STOCK } from './ink-frame-harness.ts';
import { describeStrayNames, patchNamed, payloadFunction } from './payload.ts';

const SLOW_PATCH_MS = 120_000;

const patch = patchNamed(snapshotRenderPatches, 'snapshot-stable-messages');
const recorder = patchNamed(recorderFeedPatches, 'render-profile-snapshot');

describeStrayNames(snapshotRenderPatches);

describe.skipIf(STOCK === undefined)('the snapshot patch fits the shipped bundle', () => {
  const modules = (STOCK ?? []).map((module) => module.text);

  test('it finds exactly one place and applies', () => {
    const [rebase] = rebaseAll(snapshotRenderPatches, modules);
    expect(rebase?.matches).toBe(1);
    expect(rebase === undefined ? false : applies(rebase)).toBe(true);
  });

  test(
    'it applies once with the whole render set, and the recorder hook is still fed from the return',
    () => {
      const shipped = new Set(patches.map((entry) => entry.name));
      const extra = snapshotRenderPatches.filter((entry) => !shipped.has(entry.name));
      const text = patchSource(sourceApp(), [...patches, ...extra])
        .map((module) => module.text)
        .join('\n');
      expect(text.split('.getMessagesVersion();if(').length).toBe(2);
      const feeds = text.match(/,globalThis\.\$ODr\?\.snapshot\(\w+,\w+\.getStore\(\)\),\w+\}/gu);
      expect(feeds).toHaveLength(1);
    },
    SLOW_PATCH_MS,
  );
});

interface Message {
  id: string;
}

interface Store {
  version: number;
  messagesVersion: number;
  streamingVersion: number;
  getVersion: () => number;
  getMessagesVersion: () => number;
  getStreamingVersion: () => number;
}

interface Session {
  getStore: () => Store;
}

interface Ssm {
  messages: Message[];
  displayCalls: number;
  getSessionManager: (id: string) => Session | undefined;
  getDisplayMessages: (id: string) => Message[];
}

interface Entry {
  ssm: Ssm | null;
  sessionId: string | null;
  updateMode: string;
  snapshotVersion: number;
  streamingVersion: number;
  messages: Message[];
}

interface Cache {
  current: Entry;
}

type Mode = 'store' | 'store-streaming' | 'coarse';
type Read = () => Message[];
interface Binding {
  ssm: Ssm | null;
  id: string;
  cache: Cache;
  mode: Mode;
}

type Build = (binding: Binding) => Read;

const EMPTY: Message[] = [];

function makeStore(): Store {
  const store: Store = {
    version: 0,
    messagesVersion: 0,
    streamingVersion: 0,
    getVersion: () => store.version,
    getMessagesVersion: () => store.messagesVersion,
    getStreamingVersion: () => store.streamingVersion,
  };
  return store;
}

function makeSsm(store: Store, messages: Message[]): Ssm {
  const ssm: Ssm = {
    messages,
    displayCalls: 0,
    getSessionManager: () => ({ getStore: () => store }),
    getDisplayMessages: () => {
      ssm.displayCalls += 1;
      return ssm.messages;
    },
  };
  return ssm;
}

function versions(store: Store, mode: string) {
  return {
    snapshotVersion: mode === 'coarse' ? store.messagesVersion : store.version,
    streamingVersion: mode === 'store-streaming' ? store.streamingVersion : -1,
  };
}

function compile(text: string): Build {
  const head =
    'return({ssm:f,id:y,cache:E,mode:A})=>()=>{if(!f||!y)return r4;let D=f.getSessionManager(y);if(!D)return r4;' +
    'let{snapshotVersion:O,streamingVersion:F}=k0e(D.getStore(),A),K=E.current;' +
    'if(K.ssm===f&&K.sessionId===y&&K.updateMode===A&&K.snapshotVersion===O&&';
  return payloadFunction<[Message[], typeof versions], Build>(['r4', 'k0e'], `${head}${text}`)(
    EMPTY,
    versions,
  );
}

function newCache(): Cache {
  return {
    current: {
      ssm: null,
      sessionId: null,
      updateMode: 'store',
      snapshotVersion: -1,
      streamingVersion: -1,
      messages: EMPTY,
    },
  };
}

interface Scene {
  store: Store;
  ssm: Ssm;
  cache: Cache;
  read: Read;
  list: Message[];
}

function scene(build: Build, mode: Mode = 'store'): Scene {
  const store = makeStore();
  const list = [{ id: 'a' }, { id: 'b' }];
  const ssm = makeSsm(store, list);
  const cache = newCache();
  return { store, ssm, cache, read: build({ ssm, id: 's1', cache, mode }), list };
}

const patched = compile(patch.replace);
function stockBuild(): Build {
  return compile(patch.find);
}

afterEach(() => {
  Reflect.deleteProperty(globalThis, '$ODr');
});

describe('stock', () => {
  test('a store version that moved with the same messages gives a new array', () => {
    const run = scene(stockBuild());
    const first = run.read();
    run.store.version += 1;
    expect(run.read()).not.toBe(first);
  });
});

describe('snapshot-stable-messages', () => {
  test('a store version that moved with identical messages returns the cached array', () => {
    const run = scene(patched);
    const first = run.read();
    run.store.version += 1;
    expect(run.read()).toBe(first);
  });

  test('the next call after a reuse is a cache hit, with no rebuild', () => {
    const run = scene(patched);
    const first = run.read();
    run.store.version += 1;
    run.read();
    const before = run.ssm.displayCalls;
    expect(run.read()).toBe(first);
    expect(run.ssm.displayCalls).toBe(before);
    expect(run.cache.current.snapshotVersion).toBe(1);
  });

  test('the first read gives a copy, not the store array', () => {
    const run = scene(patched);
    expect(run.read()).not.toBe(run.list);
    expect(run.read()).toEqual(run.list);
  });

  test('a message version that moved gives a new array, even with identical elements', () => {
    const run = scene(patched);
    const first = run.read();
    run.store.version += 1;
    run.store.messagesVersion += 1;
    const second = run.read();
    expect(second).not.toBe(first);
    expect(second).toEqual(first);
    expect(run.read()).toBe(second);
  });

  test('a streaming version that moved gives a new array', () => {
    const run = scene(patched, 'store-streaming');
    const first = run.read();
    run.store.version += 1;
    run.store.streamingVersion += 1;
    expect(run.read()).not.toBe(first);
  });

  test('a streaming version that did not move still reuses in a streaming mode', () => {
    const run = scene(patched, 'store-streaming');
    const first = run.read();
    run.store.version += 1;
    expect(run.read()).toBe(first);
  });

  test('an optimistic message that was added gives a new array with it', () => {
    const run = scene(patched);
    const first = run.read();
    run.ssm.messages = [...run.list, { id: 'optimistic' }];
    run.store.version += 1;
    const second = run.read();
    expect(second).not.toBe(first);
    expect(second.map((message) => message.id)).toEqual(['a', 'b', 'optimistic']);
  });

  test('an optimistic message that was removed, or a render limit that cut the list, gives a new array', () => {
    const run = scene(patched);
    run.ssm.messages = [...run.list, { id: 'optimistic' }];
    run.store.version += 1;
    const withOptimistic = run.read();
    run.ssm.messages = run.list;
    run.store.version += 1;
    const without = run.read();
    expect(without).not.toBe(withOptimistic);
    expect(without.map((message) => message.id)).toEqual(['a', 'b']);
    run.ssm.messages = run.list.slice(1);
    run.store.version += 1;
    expect(run.read().map((message) => message.id)).toEqual(['b']);
  });

  test('an element swapped for another object gives a new array', () => {
    const run = scene(patched);
    const first = run.read();
    run.ssm.messages = [{ id: 'a' }, ...run.list.slice(1)];
    run.store.version += 1;
    expect(run.read()).not.toBe(first);
  });

  test('another session id gives a new array, even with identical messages', () => {
    const run = scene(patched);
    const first = run.read();
    const other = patched({ ssm: run.ssm, id: 's2', cache: run.cache, mode: 'store' });
    expect(other()).not.toBe(first);
    expect(run.cache.current.sessionId).toBe('s2');
  });

  test('another session manager or update mode gives a new array', () => {
    const run = scene(patched);
    const first = run.read();
    const manager = makeSsm(run.store, run.list);
    expect(patched({ ssm: manager, id: 's1', cache: run.cache, mode: 'store' })()).not.toBe(first);
    const second = run.cache.current.messages;
    expect(
      patched({ ssm: manager, id: 's1', cache: run.cache, mode: 'store-streaming' })(),
    ).not.toBe(second);
  });

  test('no session manager or id gives the empty list and leaves the cache alone', () => {
    const run = scene(patched);
    const first = run.read();
    expect(patched({ ssm: null, id: 's1', cache: run.cache, mode: 'store' })()).toBe(EMPTY);
    expect(patched({ ssm: run.ssm, id: '', cache: run.cache, mode: 'store' })()).toBe(EMPTY);
    expect(run.cache.current.messages).toBe(first);
  });

  test('only the cached array is ever returned for equal content, never an older one', () => {
    const run = scene(patched);
    const first = run.read();
    run.ssm.messages = [{ id: 'x' }];
    run.store.version += 1;
    run.store.messagesVersion += 1;
    const second = run.read();
    run.ssm.messages = run.list;
    run.store.version += 1;
    run.store.messagesVersion += 1;
    const third = run.read();
    expect(second).not.toBe(first);
    expect(third).not.toBe(second);
    expect(third).toEqual(first);
  });
});

describe('the recorder hook after the patch', () => {
  const both = (): string => patch.replace.replace(recorder.find, recorder.replace);

  test('the recorder anchor still matches the text the snapshot patch leaves', () => {
    expect(patch.replace).toContain(recorder.find);
    expect(both()).not.toBe(patch.replace);
  });

  test('it is told about a new array and the store, and not about a reused one', () => {
    const seen: [Message[], Store][] = [];
    Reflect.set(globalThis, '$ODr', {
      snapshot: (messages: Message[], store: Store) => seen.push([messages, store]),
    });
    const run = scene(compile(both()));
    const first = run.read();
    expect(seen).toHaveLength(1);
    expect(seen[0]?.[0]).toBe(first);
    expect(seen[0]?.[1]).toBe(run.store);
    run.store.version += 1;
    expect(run.read()).toBe(first);
    expect(seen).toHaveLength(1);
    run.store.version += 1;
    run.store.messagesVersion += 1;
    const second = run.read();
    expect(seen).toHaveLength(2);
    expect(seen[1]?.[0]).toBe(second);
  });

  test('a Droid with no recorder runs the same code', () => {
    const run = scene(compile(both()));
    const first = run.read();
    run.store.version += 1;
    expect(run.read()).toBe(first);
  });
});
