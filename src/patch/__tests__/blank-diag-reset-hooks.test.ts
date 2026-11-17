import { expect, test } from 'bun:test';

import { blankDiagPatches, StackMode } from '../blank-diag-patches.ts';
import { applies, rebasePatch } from '../rebase.ts';
import { patchNamed, payloadFunction } from './payload.ts';

function patchedFixture(name: string, source: string): string {
  const patch = rebasePatch(patchNamed(blankDiagPatches, name), [source]);
  expect(applies(patch)).toBe(true);
  return source.replace(patch.find, patch.replace);
}

interface EpochState {
  epoch: number;
  staticRenderKey?: string;
}

interface CompactionEnd {
  phase: 'end';
  path: 'agent';
  outcome: 'succeeded' | 'failed';
}

test('a hidden-boundary epoch bump records its cause and leaves the no-reset path alone', () => {
  const source =
    'return (s,r)=>{if(r){let n=s.epoch+1,k="chat:"+n;return{epoch:n,staticRenderKey:k}}return s}';
  const calls: unknown[][] = [];
  const globals = { __odBlank: (...args: unknown[]) => calls.push(args) };
  const clock = { now: () => 42 };
  const render = payloadFunction<
    [typeof globals, typeof clock],
    (state: EpochState, reason?: string) => EpochState
  >(['globalThis', 'Date'], patchedFixture('blank-diag-epoch-reset', source))(globals, clock);

  const state = { epoch: 3 };
  expect(render(state)).toBe(state);
  expect(calls).toEqual([]);
  expect(globals).not.toHaveProperty('__odBlankEpoch');

  expect(render(state, 'hidden-boundary')).toEqual({ epoch: 4, staticRenderKey: 'chat:4' });
  expect(globals).toHaveProperty('__odBlankEpoch', {
    reason: 'hidden-boundary',
    at: 42,
  });
  expect(calls).toEqual([['epoch-reset', { reason: 'hidden-boundary', epoch: 4 }, StackMode.None]]);
});

test.each(['succeeded', 'failed'] as const)(
  'agent compaction preserves cleanup when it %s',
  (outcome) => {
    const succeeded = outcome === 'succeeded';
    const source =
      'return {compactionAbortRef:{},run(a,b,e){let q=!1;try{if(e)throw e;return q=!0,42}' +
      'finally{if(this.compactionAbortRef=null,a.clearCompactionReason(),c(b.sessionId),q)d("streaming_assistant_message")}}}';
    const calls: string[] = [];
    const globals = {
      __odBlank: (event: string, detail: CompactionEnd, mode: number) => {
        expect(event).toBe('compaction');
        expect(detail).toEqual({
          phase: 'end',
          path: 'agent',
          outcome,
        });
        expect(mode).toBe(StackMode.None);
        calls.push('log');
      },
    };
    const agent = payloadFunction<
      [typeof globals, (id: string) => void, (state: string) => void],
      {
        compactionAbortRef: unknown;
        run: (
          reason: { clearCompactionReason: () => void },
          session: { sessionId: string },
          error?: Error,
        ) => number;
      }
    >(['globalThis', 'c', 'd'], patchedFixture('blank-diag-compaction-agent-end', source))(
      globals,
      (id) => {
        calls.push(id);
      },
      (state) => {
        calls.push(state);
      },
    );
    const runCompaction = (error?: Error) =>
      agent.run(
        {
          clearCompactionReason: () => {
            calls.push('clear-reason');
          },
        },
        { sessionId: 'clear-session' },
        error,
      );

    if (succeeded) {
      expect(runCompaction()).toBe(42);
    } else {
      const failure = new Error('compaction failed');
      expect(() => runCompaction(failure)).toThrow(failure);
    }
    expect(agent.compactionAbortRef).toBeNull();
    expect(calls).toEqual([
      'log',
      'clear-reason',
      'clear-session',
      ...(succeeded ? ['streaming_assistant_message'] : []),
    ]);
  },
);
