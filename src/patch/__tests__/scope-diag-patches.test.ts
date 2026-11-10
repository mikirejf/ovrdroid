import { describe, expect, test } from 'bun:test';
import { AsyncLocalStorage } from 'node:async_hooks';
import * as fs from 'node:fs';

import { patchSource } from '../../binary/apply.ts';
import type { AppModule } from '../../binary/graph.ts';
import type { Fields } from '../../probe/fields.ts';
import { entriesOf, fieldsOfJson } from '../../probe/fields.ts';
import { patches } from '../patches.ts';
import { renderContextPatches } from '../render-context-patches.ts';
import {
  SCOPE_ANCESTRY_LIMIT,
  SCOPE_FIRE_LIMIT,
  SCOPE_SCHEDULE_LIMIT,
  scopeDiagPatches,
} from '../scope-diag-patches.ts';
import { describeStrayNames, patchNamed, payloadFunction } from './payload.ts';

describeStrayNames(scopeDiagPatches);
interface Token {
  token: string;
}
type CallbackValue = Token | number;
type Outcome = Token | number | string | null | undefined | Callback;
type Callback = (this: Token | undefined, ...args: CallbackValue[]) => Outcome;
type Schedule = (scheduled: Callback) => number;
interface SchedulerTask {
  callback: Callback | null;
  priorityLevel: number;
  expirationTime: number;
}
interface Scope {
  currentSessionId?: string;
  disposed: boolean;
  disposing: boolean;
  assertActive: () => void;
  dispose: () => Promise<void>;
  shutdown: () => Promise<void>;
}
interface ScopeClass {
  new (): Scope;
  run: <Result>(scope: Scope, callback: () => Result) => Result;
  getCurrent: () => Scope | undefined;
}
interface Diagnostic {
  wrap: (callback: Callback, kind: string) => Callback;
  task: (task: SchedulerTask) => void;
  fireTask: (...call: [SchedulerTask, Callback, Token | undefined, CallbackValue[]]) => Outcome;
  lifecycle: (event: string, scope: Scope) => void;
}
interface Globals {
  __odScopeCurrent?: () => Scope | undefined;
  __odScopeDiag?: Diagnostic;
}
interface FakeFs {
  openSync: (path: string, mode: string, permissions: number) => number;
  closeSync: (fd: number) => void;
  appendFileSync: (path: string, line: string) => void;
}
class DisposedError extends Error {
  scope: Scope;
  constructor(scope: Scope) {
    super('Agent runtime scope is disposed');
    this.name = 'DisposedError';
    this.scope = scope;
  }
}
const RUNTIME_FIXTURE =
  'class Sp{static storage=new l;disposed=!1;disposing=!1;currentSessionId="child";' +
  'static run(e,t){return Sp.storage.run(e,t)}' +
  'static getCurrent(){return Sp.storage.getStore()}' +
  'async shutdown(){}' +
  'async dispose(){if(this.disposed)return;if(!this.disposalPromise)this.disposing=!0,' +
  'this.disposalPromise=(async()=>{try{await this.shutdown()}finally{this.disposed=!0}})();await this.disposalPromise}' +
  'assertActive(){if(this.disposed||this.disposing)throw new o(this)}}return Sp';
function fixture(enabled = true, fileSystem?: FakeFs) {
  const globals: Globals = {};
  const lines: string[] = [];
  const paths: string[] = [];
  let requires = 0;
  const fakeFs: FakeFs = fileSystem ?? {
    openSync: (path) => {
      paths.push(path);
      return 1;
    },
    closeSync: () => {},
    appendFileSync: (path, line) => {
      paths.push(path);
      lines.push(line);
    },
  };
  let text = RUNTIME_FIXTURE;
  for (const patch of scopeDiagPatches) {
    text = text.replace(patch.find, patch.replace);
  }
  const create = payloadFunction<
    [typeof AsyncLocalStorage, Globals, object, () => FakeFs, typeof DisposedError],
    ScopeClass
  >(['l', 'globalThis', 'process', 'require', 'o'], text);
  const Runtime = create(
    AsyncLocalStorage,
    globals,
    { pid: 123, env: enabled ? { OD_SCOPE_LOG: '/explicit/scope.jsonl' } : {} },
    () => {
      requires += 1;
      return fakeFs;
    },
    DisposedError,
  );
  const child = new Runtime();
  const rows = (): Fields[] => lines.map((line) => fieldsOfJson(line));
  const event = (name: string): Fields => {
    const found = rows().find((row) => row.get('event') === name);
    if (found === undefined) {
      throw new Error(`no ${name} event`);
    }
    return found;
  };
  const diagnostic = (): Diagnostic => {
    if (globals.__odScopeDiag === undefined) {
      throw new Error('diagnostics are disabled');
    }
    return globals.__odScopeDiag;
  };
  return { Runtime, child, globals, rows, event, diagnostic, paths, requires: () => requires };
}
function patched(name: string): string {
  return patchNamed(scopeDiagPatches, `scope-diag-${name}`).replace;
}
function fire(work: Callback): Outcome {
  return work.call({ token: 'callback-host' });
}
describe('scope diagnostics', () => {
  test('without an explicit log path nothing initializes or writes and the original error survives', async () => {
    const out = fixture(false);
    await out.child.dispose();
    expect(out.child.assertActive.bind(out.child)).toThrow(DisposedError);
    expect(out.globals).toEqual({});
    expect(out.rows()).toEqual([]);
    expect(out.requires()).toBe(0);
  });
  test('an invalid explicit output path fails at initialization', () => {
    expect(() =>
      fixture(true, {
        openSync: () => fs.openSync('/dev/null/scope.jsonl', 'a'),
        closeSync: () => {},
        appendFileSync: () => {},
      }),
    ).toThrow();
  });
  test('disposal and inactive reads retain raw session ID, owning identity and original throw', async () => {
    const out = fixture();
    Object.defineProperty(out.child, 'sessionId', {
      get: () => {
        throw new Error('do not use this getter');
      },
    });
    await out.Runtime.run(out.child, async () => {
      await out.child.dispose();
    });
    expect(out.child.assertActive.bind(out.child)).toThrow(
      expect.objectContaining({
        name: 'DisposedError',
        message: 'Agent runtime scope is disposed',
        scope: out.child,
      }),
    );
    expect(out.event('dispose-start').get('scope')).toEqual({
      scopeId: 1,
      sessionId: 'child',
      disposed: false,
      disposing: false,
    });
    expect(out.event('inactive-read').get('scope')).toEqual({
      scopeId: 1,
      sessionId: 'child',
      disposed: true,
      disposing: true,
    });
    expect(out.event('inactive-read').get('activeScope')).toBeNull();
    expect(out.event('inactive-read').get('stack')).toContain('assertActive');
    expect(new Set(out.paths)).toEqual(new Set(['/explicit/scope.jsonl']));
  });
  test('disposing reads and lifecycle rejections are not weakened or swallowed', async () => {
    const out = fixture();
    const failure = new Error('shutdown failed');
    out.child.shutdown = async () => {
      await Promise.resolve();
      throw failure;
    };
    const disposing = out.child.dispose();
    expect(out.child.assertActive.bind(out.child)).toThrow(DisposedError);
    expect(out.event('inactive-read').get('scope')).toMatchObject({
      disposed: false,
      disposing: true,
    });
    try {
      await disposing;
      throw new Error('dispose did not reject');
    } catch (error) {
      expect(error).toBe(failure);
    }
  });
  test('callback wrappers preserve receiver, arguments, return value, thrown identity and ALS scope', async () => {
    const out = fixture();
    const receiver = { token: 'receiver' };
    const args = [{ token: 'arg' }, 42];
    const result = { token: 'result' };
    const failure = new Error('same error');
    const wrappedWork = out.Runtime.run(out.child, () =>
      out.diagnostic().wrap(function observe(...received) {
        expect(this).toBe(receiver);
        expect(received).toEqual(args);
        expect(out.Runtime.getCurrent()).toBe(out.child);
        return result;
      }, 'ui-ticker'),
    );
    await out.child.dispose();
    expect(out.Runtime.run(out.child, () => wrappedWork.apply(receiver, args))).toBe(result);
    const throws = out.diagnostic().wrap(() => {
      throw failure;
    }, 'react-immediate');
    expect(() => fire(throws)).toThrow(failure);
    out.diagnostic().lifecycle('after-throw', out.child);
    expect(out.event('after-throw').get('ancestry')).toEqual([]);
  });
  test.each([false, true])(
    'ticker schedules React immediate work with root context %s',
    async (root) => {
      const out = fixture();
      const timers: Callback[] = [];
      const immediates: Callback[] = [];
      const scheduler = patchNamed(renderContextPatches, 'render-root-context-scheduler');
      const subscribe = payloadFunction<
        [Globals, Schedule, Schedule, Callback, typeof AsyncLocalStorage],
        () => void
      >(
        ['globalThis', 'setImmediate', 'setInterval', 'cc', 'ALS'],
        `var $ODroot=ALS.snapshot();var ${root ? scheduler.replace : scheduler.find};var wQ=NQ,Ka;${patched('react-immediate')}` +
          `var xS=new Set,uf,yS,FY=125;${patched('ui-ticker')}return()=>Xe1(Ka)`,
      )(
        out.globals,
        (scheduled) => immediates.push(scheduled),
        (scheduled) => timers.push(scheduled),
        () => {
          expect(out.Runtime.getCurrent()).toBe(root ? undefined : out.child);
          out.Runtime.getCurrent()?.assertActive();
          return null;
        },
        AsyncLocalStorage,
      );
      out.Runtime.run(out.child, subscribe);
      const [tick] = timers;
      if (tick === undefined) {
        throw new Error('ticker did not schedule');
      }
      out.Runtime.run(out.child, () => fire(tick));
      await out.child.dispose();
      const [immediate] = immediates;
      if (immediate === undefined) {
        throw new Error('cached setImmediate path did not schedule');
      }
      const invoke = () => out.Runtime.run(out.child, () => fire(immediate));
      if (root) {
        expect(invoke()).toBeNull();
      } else {
        expect(invoke).toThrow(DisposedError);
      }
      const [tickerFrame, immediateFrame] = entriesOf(out.event('fire'), 'ancestry');
      expect(tickerFrame?.get('kind')).toBe('ui-ticker');
      const scheduled = { sessionId: 'child', disposed: false };
      expect(tickerFrame?.get('scheduledScope')).toMatchObject(scheduled);
      expect(tickerFrame?.get('firedScope')).toMatchObject(scheduled);
      expect(tickerFrame?.get('scheduleStack')).toBeString();
      expect(immediateFrame?.get('kind')).toBe('react-immediate');
      expect(immediateFrame?.get('ownerAtFire')).toMatchObject({ disposed: true });
      expect(immediateFrame?.get('firedScope')).toEqual(
        root ? null : immediateFrame?.get('ownerAtFire'),
      );
      out.diagnostic().lifecycle('after-error', out.child);
      expect(out.event('after-error').get('ancestry')).toEqual([]);
    },
  );
  test.each(['scheduleMicrotask', 'scheduleTimeout'] as const)(
    '%s records scheduling in the child and firing in the root',
    async (method) => {
      const out = fixture();
      const host = payloadFunction<
        [Globals, typeof AsyncLocalStorage],
        {
          scheduleMicrotask: typeof queueMicrotask;
          scheduleTimeout: typeof setTimeout;
        }
      >(
        ['globalThis', 'ALS'],
        `var $ODroot=ALS.snapshot();return{${patched('react-host-schedulers')}}`,
      )(out.globals, AsyncLocalStorage);
      const done = Promise.withResolvers<Scope | undefined>();
      await out.child.dispose();
      out.Runtime.run(out.child, () => {
        host[method](() => {
          done.resolve(out.Runtime.getCurrent());
        });
      });
      expect(await done.promise).toBeUndefined();
      const owner = { sessionId: 'child', disposed: true };
      expect(out.event('schedule').get('scheduledScope')).toMatchObject(owner);
      expect(out.event('fire').get('firedScope')).toBeNull();
      expect(out.event('fire').get('ownerAtFire')).toMatchObject(owner);
      expect(out.event('fire').get('scheduleStack')).toBeString();
    },
  );
  test.skipIf(Bun.env['OD_SCOPE_SOURCE_DIR'] === undefined)(
    'every diagnostic anchor applies after the shipped patches on a real extraction',
    async () => {
      const directory = Bun.env['OD_SCOPE_SOURCE_DIR'];
      const modules: AppModule[] = await Promise.all(
        [...new Bun.Glob('*.js').scanSync(directory)].map(async (name) => ({
          name,
          text: await Bun.file(`${directory}/${name}`).text(),
        })),
      );
      const [head, ...rest] = modules;
      if (head === undefined) {
        throw new Error('stock extraction is empty');
      }
      expect(patchSource([head, ...rest], [...patches, ...scopeDiagPatches])).toHaveLength(
        modules.length,
      );
    },
  );
  test('React task identity, callback cancellation shape and continuation return are unchanged', async () => {
    const out = fixture();
    const continuation = () => out.child.currentSessionId;
    const task = { callback: () => continuation, priorityLevel: 3, expirationTime: 0 };
    out.Runtime.run(out.child, () => {
      out.diagnostic().task(task);
    });
    const run = payloadFunction<[Globals, typeof task], Callback | undefined>(
      ['globalThis', 'xe'],
      `var Xt,e=1,g=xe.callback;${patched('react-fire')}return c`,
    );
    expect(run(out.globals, task)).toBe(continuation);
    expect(task.callback).toBeNull();
    await out.child.dispose();
    expect(
      out.Runtime.run(out.child, () =>
        out.diagnostic().fireTask(task, continuation, undefined, []),
      ),
    ).toBe('child');
    expect(out.event('fire').get('kind')).toBe('react-task');
    expect(out.event('fire').get('scheduledScope')).toMatchObject({ disposed: false });
    expect(out.event('fire').get('firedScope')).toMatchObject({ disposed: true });
  });
  test('normal ticks are silent, repeated disposed ticks report once and total callback logs are bounded', async () => {
    const out = fixture();
    const wrappedWork = out.Runtime.run(out.child, () =>
      out.diagnostic().wrap(() => 7, 'ui-ticker'),
    );
    for (let index = 0; index < 20; index += 1) {
      expect(out.Runtime.run(out.child, () => fire(wrappedWork))).toBe(7);
    }
    expect(out.rows().filter((row) => row.get('event') === 'fire')).toHaveLength(0);
    await out.child.dispose();
    for (let index = 0; index < 20; index += 1) {
      out.Runtime.run(out.child, () => fire(wrappedWork));
    }
    expect(out.rows().filter((row) => row.get('event') === 'fire')).toHaveLength(1);
    for (let index = 0; index < Math.max(SCOPE_SCHEDULE_LIMIT, SCOPE_FIRE_LIMIT) + 2; index += 1) {
      out.Runtime.run(out.child, () => fire(out.diagnostic().wrap(() => 7, 'react-task')));
    }
    expect(out.rows().filter((row) => row.get('event') === 'schedule')).toHaveLength(
      SCOPE_SCHEDULE_LIMIT,
    );
    expect(out.rows().filter((row) => row.get('event') === 'fire')).toHaveLength(SCOPE_FIRE_LIMIT);
    expect(out.rows().filter((row) => row.get('event') === 'limit')).toHaveLength(2);
  });
  test('ancestry is bounded and separate objects sharing a session ID retain distinct identities', () => {
    const out = fixture();
    const second = new out.Runtime();
    out.diagnostic().lifecycle('second', second);
    out.diagnostic().lifecycle('first', out.child);
    expect(out.event('first').get('scope')).not.toEqual(out.event('second').get('scope'));
    const nest = (depth: number): void => {
      if (depth === 0) {
        out.diagnostic().lifecycle('deep', out.child);
        return;
      }
      fire(
        out.diagnostic().wrap(() => {
          nest(depth - 1);
          return null;
        }, 'react-task'),
      );
    };
    nest(SCOPE_ANCESTRY_LIMIT + 4);
    expect(out.event('deep').get('ancestry')).toHaveLength(SCOPE_ANCESTRY_LIMIT);
  });
});
