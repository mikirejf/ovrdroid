import { describe, expect, test } from 'bun:test';
import { AsyncLocalStorage } from 'node:async_hooks';

import { renderContextPatches } from '../render-context-patches.ts';
import { describeStrayNames, patchNamed, payloadFunction } from './payload.ts';

describeStrayNames(renderContextPatches);

type Callback = (...args: string[]) => void;
type Timer = ReturnType<typeof setTimeout>;
type TimeoutScheduler = (callback: Callback, ms?: number, ...args: string[]) => Timer;
type RequireHooks = (name: string) => { AsyncLocalStorage: typeof AsyncLocalStorage };

interface Scheduling {
  immediate: (callback: Callback, ...args: string[]) => ReturnType<typeof setImmediate>;
  schedulerTimeout: TimeoutScheduler;
  schedulerCancelTimeout: typeof clearTimeout;
  scheduleMicrotask: (callback: Callback) => void;
  scheduleTimeout: TimeoutScheduler;
  cancelTimeout: typeof clearTimeout;
}

interface AgentScope {
  sessionId: string;
  daemonConnection: string;
}

function scheduling(patched: boolean): Scheduling {
  const snapshot = patchNamed(renderContextPatches, 'render-root-context-snapshot');
  const scheduler = patchNamed(renderContextPatches, 'render-root-context-scheduler');
  const host = patchNamed(renderContextPatches, 'render-root-context-host');
  const field = patched ? 'replace' : 'find';
  return payloadFunction<[RequireHooks], Scheduling>(
    ['require'],
    `${snapshot.replace.slice(0, -snapshot.find.length)}var ${scheduler[field]};return{immediate:NQ,schedulerTimeout:RQ,schedulerCancelTimeout:vQ,${host[field]}}`,
  )(() => ({ AsyncLocalStorage }));
}

async function observe(
  schedule: Scheduling['immediate'] | TimeoutScheduler | Scheduling['scheduleMicrotask'],
  storage: AsyncLocalStorage<AgentScope>,
): Promise<AgentScope | undefined> {
  const observed = Promise.withResolvers<AgentScope | undefined>();
  schedule(() => {
    observed.resolve(storage.getStore());
  });
  return await observed.promise;
}

describe('render scheduling uses the module initialization context', () => {
  test.each(['immediate', 'schedulerTimeout', 'scheduleMicrotask', 'scheduleTimeout'] as const)(
    '%s leaves the agent scope while the stock callback inherits it',
    async (method) => {
      const storage = new AsyncLocalStorage<AgentScope>();
      const scope = { sessionId: 'agent-1', daemonConnection: 'connected' };
      const stock = scheduling(false);
      const patched = scheduling(true);
      const observed = await storage.run(scope, async () => {
        const before = await observe(stock[method], storage);
        const after = await observe(patched[method], storage);
        expect(storage.getStore()).toBe(scope);
        return { before, after };
      });
      expect(observed.before).toBe(scope);
      expect(observed.after).toBeUndefined();
    },
  );

  test.each(['immediate', 'schedulerTimeout', 'scheduleTimeout'] as const)(
    '%s forwards callback arguments',
    async (method) => {
      const patched = scheduling(true);
      const args = Promise.withResolvers<string[]>();
      const callback = (...received: string[]): void => {
        args.resolve(received);
      };
      if (method === 'immediate') {
        patched[method](callback, 'first', 'second');
      } else {
        patched[method](callback, 0, 'first', 'second');
      }
      expect(await args.promise).toEqual(['first', 'second']);
    },
  );

  test('scheduler and host timeout handles still cancel their callbacks', async () => {
    const patched = scheduling(true);
    const fired: string[] = [];
    const schedulerHandle = patched.schedulerTimeout(() => {
      fired.push('scheduler');
    }, 0);
    const hostHandle = patched.scheduleTimeout(() => {
      fired.push('host');
    }, 0);
    expect(schedulerHandle).toBeDefined();
    expect(hostHandle).toBeDefined();
    patched.schedulerCancelTimeout(schedulerHandle);
    patched.cancelTimeout(hostHandle);
    await Bun.sleep(10);
    expect(fired).toEqual([]);
  });
});
