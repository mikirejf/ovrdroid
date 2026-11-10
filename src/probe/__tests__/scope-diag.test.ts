import { describe, expect, test } from 'bun:test';
import { AsyncLocalStorage } from 'node:async_hooks';

import { patchSource } from '../../binary/apply.ts';
import { patchNamed, payloadFunction } from '../../patch/__tests__/payload.ts';
import { rebaseAll } from '../../patch/rebase.ts';
import {
  SCOPE_DIAG_RUNTIME,
  SCOPE_FOOTER_LIMIT,
  scopeDiagPatches,
} from '../../patch/scope-diag-patches.ts';
import { freeNames, renameIn } from '../../patch/tokens.ts';
import { fieldsOfJson } from '../fields.ts';
import { chosenSets } from '../probe-patch-sets.ts';

interface Token {
  token: string;
}
type CallbackValue = Token | number;
type Callback = (this: Token | undefined, ...args: CallbackValue[]) => Token | number;
type HostSchedule = (this: Token | undefined, work: Callback, ...args: CallbackValue[]) => Token;
interface HostSchedulers {
  scheduleMicrotask: HostSchedule;
  scheduleTimeout: HostSchedule;
  cancelTimeout: (handle: Token) => void;
}
interface Scope {
  currentSessionId: string;
  disposed: boolean;
  disposing: boolean;
}
interface Diagnostic {
  wrap: (work: Callback, kind: string) => Callback;
  footer: () => void;
  lifecycle: (event: string, scope: Scope) => void;
}
interface Globals {
  __odScopeCurrent?: () => Scope | undefined;
  __odScopeDiag?: Diagnostic;
}

function fixture(enabled = true) {
  const storage = new AsyncLocalStorage<Scope>();
  const globals: Globals = {};
  const child = { currentSessionId: 'child', disposed: false, disposing: false };
  const lines: string[] = [];
  const fileSystem = {
    openSync: () => 1,
    closeSync: () => {},
    appendFileSync: (_path: string, line: string) => {
      lines.push(line);
    },
  };
  let requires = 0;
  if (enabled) {
    globals.__odScopeCurrent = () => storage.getStore();
    globals.__odScopeDiag = payloadFunction<[Globals, object, () => typeof fileSystem], Diagnostic>(
      ['globalThis', 'process', 'require'],
      `return ${SCOPE_DIAG_RUNTIME}`,
    )(globals, { pid: 123, env: { OD_SCOPE_LOG: '/explicit/scope.jsonl' } }, () => {
      requires += 1;
      return fileSystem;
    });
  }
  const rows = () => lines.map((line) => fieldsOfJson(line));
  const event = (name: string) => {
    const found = rows().find((row) => row.get('event') === name);
    if (found === undefined) {
      throw new Error(`no ${name} event`);
    }
    return found;
  };
  const diagnostic = () => {
    if (globals.__odScopeDiag === undefined) {
      throw new Error('diagnostics disabled');
    }
    return globals.__odScopeDiag;
  };
  return {
    child,
    globals,
    rows,
    event,
    diagnostic,
    requires: () => requires,
    Runtime: { run: storage.run.bind(storage), getCurrent: () => storage.getStore() },
  };
}

function patched(name: string): string {
  return patchNamed(scopeDiagPatches, `scope-diag-${name}`).replace;
}

function hostSchedulers(
  globals: Globals,
  schedule: HostSchedule,
  cancel: (handle: Token) => void = () => {},
): HostSchedulers {
  return payloadFunction<
    [Globals, HostSchedule, HostSchedule, (handle: Token) => void],
    HostSchedulers
  >(
    ['globalThis', 'queueMicrotask', 'setTimeout', 'clearTimeout'],
    `return {${patched('react-host-schedulers')}}`,
  )(globals, schedule, schedule, cancel);
}

function footerSettings(globals: Globals, settings: () => boolean): boolean {
  return payloadFunction<[Globals, () => { getShowTokenUsageIndicator: () => boolean }], boolean>(
    ['globalThis', 'm'],
    `var r1,e1="1s",o1,g=7,WN1=()=>true;${patched('footer-settings')}return o1`,
  )(globals, () => ({ getShowTokenUsageIndicator: settings }));
}

function thrownBy(run: () => Token | number): Error {
  try {
    run();
  } catch (error) {
    if (!(error instanceof Error)) {
      throw error;
    }
    return error;
  }
  throw new Error('expected a throw');
}

describe('opt-in scope diagnostics', () => {
  test.each(['scheduleMicrotask', 'scheduleTimeout'] as const)(
    '%s preserves scheduler and callback receivers, args, results, errors and firing context',
    (method) => {
      const out = fixture();
      const pending: Callback[] = [];
      const schedulerHost = { token: 'scheduler-host' };
      const callbackHost = { token: 'callback-host' };
      const handle = { token: 'timer-handle' };
      const result = { token: 'callback-result' };
      const callbackArgs = [{ token: 'callback-arg' }, 42];
      const schedulerArgs = [15, { token: 'timeout-arg' }];
      const scheduler: HostSchedule = function scheduler(work, ...args) {
        expect(this).toBe(schedulerHost);
        expect(args).toEqual(schedulerArgs);
        expect(out.Runtime.getCurrent()).toBe(out.child);
        pending.push(work);
        return handle;
      };
      let cancelled: Token | undefined;
      const host = hostSchedulers(out.globals, scheduler, (value) => {
        cancelled = value;
      });
      const other = { currentSessionId: 'other', disposed: false, disposing: false };
      const work: Callback = function work(...args) {
        expect(this).toBe(callbackHost);
        expect(args).toEqual(callbackArgs);
        expect(out.Runtime.getCurrent()).toBe(other);
        return result;
      };
      expect(
        out.Runtime.run(out.child, () => host[method].call(schedulerHost, work, ...schedulerArgs)),
      ).toBe(handle);
      host.cancelTimeout(handle);
      expect(cancelled).toBe(handle);
      out.child.disposed = true;
      const [scheduled] = pending;
      if (scheduled === undefined) {
        throw new Error('host did not schedule');
      }
      expect(out.Runtime.run(other, () => scheduled.apply(callbackHost, callbackArgs))).toBe(
        result,
      );
      const kind = method === 'scheduleMicrotask' ? 'react-microtask' : 'react-timeout';
      expect(out.event('schedule').get('kind')).toBe(kind);
      expect(out.event('fire').get('kind')).toBe(kind);
      expect(out.event('fire').get('ownerAtFire')).toMatchObject({
        sessionId: 'child',
        disposed: true,
      });
      expect(out.event('fire').get('firedScope')).toMatchObject({
        sessionId: 'other',
        disposed: false,
      });
      const failure = new Error('callback failed');
      out.Runtime.run(out.child, () =>
        host[method].call(
          schedulerHost,
          () => {
            throw failure;
          },
          ...schedulerArgs,
        ),
      );
      const [, throwing] = pending;
      if (throwing === undefined) {
        throw new Error('host did not schedule throwing callback');
      }
      expect(thrownBy(() => throwing.call(callbackHost))).toBe(failure);
      out.diagnostic().lifecycle('after-host-error', out.child);
      expect(out.event('after-host-error').get('ancestry')).toEqual([]);
      const schedulerFailure = new Error('scheduler failed');
      const throws: HostSchedule = () => {
        throw schedulerFailure;
      };
      const failedHost = hostSchedulers(out.globals, throws);
      expect(thrownBy(() => failedHost[method].call(schedulerHost, work))).toBe(schedulerFailure);
    },
  );

  test('disabled host and footer observations do not initialize, write or replace callbacks', () => {
    const out = fixture(false);
    const handle = { token: 'handle' };
    const originalWork: Callback = () => handle;
    const receiver = { token: 'scheduler' };
    const scheduler: HostSchedule = function scheduler(work, ...args) {
      expect(work).toBe(originalWork);
      expect(this).toBe(receiver);
      expect(args).toEqual([10, handle]);
      return handle;
    };
    const host = hostSchedulers(out.globals, scheduler);
    expect(host.scheduleMicrotask.call(receiver, originalWork, 10, handle)).toBe(handle);
    expect(host.scheduleTimeout.call(receiver, originalWork, 10, handle)).toBe(handle);
    expect(footerSettings(out.globals, () => true)).toBe(true);
    expect(out.globals).toEqual({});
    expect(out.rows()).toEqual([]);
    expect(out.requires()).toBe(0);
  });

  test('native microtasks and timeouts retain inherited ALS after disposal without rebinding', async () => {
    const out = fixture();
    const host = payloadFunction<
      [Globals, typeof queueMicrotask, typeof setTimeout, typeof clearTimeout],
      {
        scheduleMicrotask: typeof queueMicrotask;
        scheduleTimeout: typeof setTimeout;
        cancelTimeout: typeof clearTimeout;
      }
    >(
      ['globalThis', 'queueMicrotask', 'setTimeout', 'clearTimeout'],
      `return {${patched('react-host-schedulers')}}`,
    )(out.globals, queueMicrotask, setTimeout, clearTimeout);
    const seen: string[] = [];
    const done = Promise.withResolvers<null>();
    out.Runtime.run(out.child, () => {
      host.scheduleMicrotask(() => {
        expect(out.Runtime.getCurrent()).toBe(out.child);
        seen.push('microtask');
      });
      host.scheduleTimeout(
        (arg: string) => {
          expect(arg).toBe('timer-argument');
          expect(out.Runtime.getCurrent()).toBe(out.child);
          seen.push('timeout');
          done.resolve(null);
        },
        0,
        'timer-argument',
      );
      out.child.disposed = true;
    });
    await done.promise;
    expect(seen).toEqual(['microtask', 'timeout']);
    expect(
      out
        .rows()
        .filter((row) => row.get('event') === 'fire')
        .map((row) => row.get('kind')),
    ).toEqual(['react-microtask', 'react-timeout']);
    expect(out.Runtime.getCurrent()).toBeUndefined();
  });

  test('footer settings observes only active scope, retains reads and throws, and bounds output', () => {
    const out = fixture();
    let reads = 0;
    const read = () => {
      reads += 1;
      return true;
    };
    expect(footerSettings(out.globals, read)).toBe(true);
    expect(out.rows()).toHaveLength(1);
    out.Runtime.run(out.child, () => {
      expect(footerSettings(out.globals, read)).toBe(true);
    });
    expect(out.event('footer-render').get('activeScope')).toMatchObject({
      sessionId: 'child',
      disposed: false,
    });
    expect(out.event('footer-render').get('stack')).toBeString();
    expect(reads).toBe(2);
    const failure = new Error('settings failed');
    expect(() =>
      out.Runtime.run(out.child, () =>
        footerSettings(out.globals, () => {
          throw failure;
        }),
      ),
    ).toThrow(failure);
    out.child.disposed = true;
    for (let index = 0; index < SCOPE_FOOTER_LIMIT + 2; index += 1) {
      out.Runtime.run(out.child, () => footerSettings(out.globals, read));
    }
    const rows = out.rows().filter((row) => row.get('event') === 'footer-render');
    expect(rows).toHaveLength(SCOPE_FOOTER_LIMIT);
    expect(rows[2]?.get('activeScope')).toMatchObject({ disposed: true });
    expect(out.event('limit').get('kind')).toBe('footer-render');
  });

  test('the diagnostic build set is absent by default', () => {
    expect(chosenSets({})).toEqual([]);
    expect(chosenSets({ scope: true })).toEqual([...scopeDiagPatches]);
  });

  test('every short captured name can change without changing payload-owned bindings', () => {
    const sources = scopeDiagPatches.map((patch) => patch.find + (patch.until ?? ''));
    const modules = sources.map((source) =>
      renameIn(source, new Map(freeNames(source).map((name) => [name, `$renamed_${name}`]))),
    );
    expect(rebaseAll(scopeDiagPatches, modules).map((entry) => entry.status)).toEqual(
      sources.map((source) => (freeNames(source).length === 0 ? 'unchanged' : 'rebased')),
    );
  });

  test.skipIf(Bun.env['OD_SCOPE_SOURCE_DIR'] === undefined)(
    'every diagnostic anchor applies once across the cached stock extraction',
    async () => {
      const directory = Bun.env['OD_SCOPE_SOURCE_DIR'];
      if (directory === undefined) {
        throw new Error('set OD_SCOPE_SOURCE_DIR to a stock extraction');
      }
      const files = [...new Bun.Glob('*.js').scanSync(directory)];
      const modules = await Promise.all(
        files.map(async (name) => ({ name, text: await Bun.file(`${directory}/${name}`).text() })),
      );
      const results = rebaseAll(
        scopeDiagPatches,
        modules.map((module) => module.text),
      );
      expect(results.map((entry) => [entry.name, entry.matches, entry.unresolved])).toEqual(
        scopeDiagPatches.map((patch) => [patch.name, 1, []]),
      );
      const [head, ...rest] = modules;
      if (head === undefined) {
        throw new Error('stock extraction is empty');
      }
      expect(patchSource([head, ...rest], scopeDiagPatches)).toHaveLength(modules.length);
    },
  );
});
