import { describe, expect, test } from 'bun:test';

import type { Fields } from '../../probe/fields.ts';
import { fieldsOfJson } from '../../probe/fields.ts';
import {
  BLANK_LOG_FILE,
  BLANK_LOG_WRITER,
  blankDiagPatches,
  CLEAR_CAUSE,
  SCOPED_READS_PER_SECOND,
  STACK_HEAD_FRAMES,
  STACK_TAIL_FRAMES,
  StackMode,
} from '../blank-diag-patches.ts';
import { applies, rebaseAll, rebasePatch } from '../rebase.ts';
import { describeStrayNames, patchNamed, payloadFunction } from './payload.ts';
import { stockDroid } from './stock-scanner.ts';

describeStrayNames(blankDiagPatches);

describe.skipIf(stockDroid === undefined)('blank diagnostics on stock Droid', () => {
  const rebased = rebaseAll(
    blankDiagPatches,
    (stockDroid ?? []).map((module) => module.text),
  );
  test.each(rebased.map((patch) => [patch.name, patch] as const))('%s applies', (_name, patch) => {
    expect(applies(patch)).toBe(true);
    expect(patch.matches).toBe(1);
  });
});

function patchedFixture(name: string, source: string): string {
  const patch = rebasePatch(patchNamed(blankDiagPatches, `blank-diag-${name}`), [source]);
  expect(applies(patch)).toBe(true);
  return source.replace(patch.find, patch.replace);
}

type Detail = Readonly<Record<string, string>>;
type Write = (event: string, detail: Detail, mode: number) => void;

interface FakeFs {
  mkdirSync: () => null;
  appendFileSync?: (file: string, data: string) => void;
}

interface FakeOs {
  homedir: () => string;
}

type FakeRequire = (name: string) => FakeFs | FakeOs;

interface Sink {
  write: Write;
  rows: () => Fields[];
  files: Set<string>;
}

interface ResizeGlobals {
  __odBlankWhy?: { reason: string; at: number };
}

interface Screen {
  name: string;
}

function writerWith(fakeRequire: FakeRequire): Write {
  return payloadFunction<[FakeRequire], Write>(
    ['require'],
    `return ${BLANK_LOG_WRITER}`,
  )(fakeRequire);
}

function sink(): Sink {
  const lines: string[] = [];
  const files = new Set<string>();
  const fs: FakeFs = {
    mkdirSync: () => null,
    appendFileSync: (file, data) => {
      files.add(file);
      lines.push(data);
    },
  };
  const os: FakeOs = { homedir: () => '/home/test' };
  return {
    write: writerWith((name) => (name === 'fs' ? fs : os)),
    files,
    rows: () => lines.map((entry) => fieldsOfJson(entry)),
  };
}

function readOnlyRequire(name: string): FakeFs | FakeOs {
  return name === 'fs'
    ? {
        mkdirSync: () => {
          throw new Error('read-only');
        },
      }
    : { homedir: () => '/x' };
}

describe('the log writer', () => {
  test('one line per call in the ovrdroid folder, with time, pid, event, visible session and detail', () => {
    Reflect.set(globalThis, '__odBlankSid', 'visible');
    const out = sink();
    out.write('compaction', { phase: 'start' }, StackMode.None);
    expect([...out.files]).toEqual([`/home/test/.factory/ovrdroid/${BLANK_LOG_FILE}`]);
    const [row] = out.rows();
    expect(row?.get('pid')).toBe(process.pid);
    expect(row?.get('event')).toBe('compaction');
    expect(row?.get('sid')).toBe('visible');
    expect(row?.get('agentScope')).toBeNull();
    expect(row?.get('phase')).toBe('start');
    expect(row?.has('stack')).toBe(false);
    Reflect.deleteProperty(globalThis, '__odBlankSid');
  });

  test('a stack is attached when asked, starting at the caller', () => {
    const out = sink();
    out.write('static-reset', {}, StackMode.Always);
    const stack = out.rows()[0]?.get('stack');
    expect(typeof stack).toBe('string');
    expect(String(stack).split('\n')[0]).not.toContain('Error');
  });

  test('a deep stack keeps its top and its bottom, which name the hook and what started the work', () => {
    const out = sink();
    const deep = (depth: number): void => {
      if (depth === 0) {
        out.write('static-reset', {}, StackMode.Always);
        return;
      }
      deep(depth - 1);
    };
    deep(80);
    const lines = String(out.rows()[0]?.get('stack')).split('\n');
    expect(lines).toHaveLength(STACK_HEAD_FRAMES + 1 + STACK_TAIL_FRAMES);
    expect(lines[STACK_HEAD_FRAMES]).toMatch(/^\.\.\. \d+ frames \.\.\.$/u);
  });

  test('an active agent scope with a daemon connection is named by its session', () => {
    Reflect.set(globalThis, '__odBlankScope', () => ({
      daemonConnection: {},
      sessionId: 'agent-1',
    }));
    const out = sink();
    out.write('empty-render', {}, StackMode.None);
    expect(out.rows()[0]?.get('agentScope')).toBe('agent-1');
    Reflect.deleteProperty(globalThis, '__odBlankScope');
  });

  test('scoped reads from one call site are written once a minute, and repeats are counted', () => {
    const out = sink();
    for (let i = 0; i < 3; i += 1) {
      out.write('scoped-read', {}, StackMode.Throttled);
    }
    expect(out.rows()).toHaveLength(1);
    expect(out.rows()[0]?.get('skippedSameStack')).toBe(0);
  });

  test(`no more than ${SCOPED_READS_PER_SECOND} scoped-read stacks are taken per second`, () => {
    const out = sink();
    const sites = Array.from({ length: SCOPED_READS_PER_SECOND + 3 }, (_unused, index) =>
      payloadFunction<[Write], () => void>(
        ['write'],
        `return function site${index}(){write("scoped-read",{},2)}`,
      ),
    );
    const start = Date.now();
    for (const site of sites) {
      site(out.write)();
    }
    const sameSecond = Math.floor(start / 1000) === Math.floor(Date.now() / 1000);
    expect(out.rows().length).toBe(sameSecond ? SCOPED_READS_PER_SECOND : out.rows().length);
    expect(out.rows().length).toBeGreaterThan(1);
  });

  test('a failing file system never throws into Droid', () => {
    const write = writerWith(readOnlyRequire);
    expect(() => {
      write('static-reset', {}, StackMode.Always);
    }).not.toThrow();
  });
});

describe('the clear cause', () => {
  const cause = payloadFunction<[], string>([], `return ${CLEAR_CAUSE}`);

  test('a recent epoch reset wins over a recent resize, and stale ones are ignored', () => {
    Reflect.set(globalThis, '__odBlankWhy', {
      reason: 'resize:rebuildChatOnWidthChange',
      at: Date.now(),
    });
    expect(cause()).toBe('resize:rebuildChatOnWidthChange');
    Reflect.set(globalThis, '__odBlankEpoch', { reason: 'retracted-segment', at: Date.now() });
    expect(cause()).toBe('retracted-segment');
    Reflect.set(globalThis, '__odBlankEpoch', {
      reason: 'retracted-segment',
      at: Date.now() - 5000,
    });
    Reflect.set(globalThis, '__odBlankWhy', { reason: 'resize:x', at: Date.now() - 5000 });
    expect(cause()).toBe('unattributed');
    Reflect.deleteProperty(globalThis, '__odBlankEpoch');
    Reflect.deleteProperty(globalThis, '__odBlankWhy');
  });
});

describe('rebased diagnostic sites preserve stock behavior', () => {
  test('scoped reads keep registration and adapter selection, logging only a missing visible session', () => {
    const events: string[] = [];
    const globals = {
      __odBlankSid: 'main',
      __odBlank: (event: string) => events.push(event),
    };
    let found = false;
    const adapter = {
      getSessionStateManager: () => ({
        getSessionManager: () => (found ? {} : undefined),
      }),
    };
    let scope: object | undefined = { daemonConnection: {} };
    let registrations = 0;
    const fallback = {};
    const source =
      'function a(){if(b(c),d()?.daemonConnection){let e=f(h);if(e)return e}return fallback}return a';
    const get = payloadFunction<
      [object, () => void, object, () => object | undefined, () => object, object, object],
      () => object
    >(['globalThis', 'b', 'c', 'd', 'f', 'h', 'fallback'], patchedFixture('scoped-read', source))(
      globals,
      () => {
        registrations += 1;
      },
      {},
      () => scope,
      () => adapter,
      {},
      fallback,
    );
    expect(get()).toBe(adapter);
    expect(events).toEqual(['scoped-read']);
    found = true;
    expect(get()).toBe(adapter);
    scope = undefined;
    expect(get()).toBe(fallback);
    expect(events).toEqual(['scoped-read']);
    expect(registrations).toBe(3);
  });

  test.each([true, false])(
    'resize attribution forwards width changed=%s to the dispatcher',
    (width) => {
      const globals: ResizeGlobals = {};
      const calls: [Screen, string, boolean][] = [];
      const screen = { name: 'chat' };
      const source = 'function run(width){let q;q=!1,a(b.current,c(b.current),width)}return run';
      const run = payloadFunction<
        [
          ResizeGlobals,
          (target: Screen, policy: string, changed: boolean) => void,
          object,
          () => string,
        ],
        (changed: boolean) => void
      >(['globalThis', 'a', 'b', 'c'], patchedFixture('resize-cause', source))(
        globals,
        (...args) => {
          calls.push(args);
        },
        { current: screen },
        () => 'rebuildChatOnWidthChange',
      );
      run(width);
      expect(calls).toEqual([[screen, 'rebuildChatOnWidthChange', width]]);
      expect(globals.__odBlankWhy?.reason).toBe(
        `resize:rebuildChatOnWidthChange${width ? '' : ' (height only)'}`,
      );
    },
  );

  test.each([true, false])(
    'manual failure keeps the original throw and aborted=%s log selection',
    (aborted) => {
      const events: Detail[] = [];
      const logs: string[] = [];
      const failure = new Error('compaction failed');
      const source =
        'try{throw failure}catch(error){let stopped=signal?.aborted===!0;throw log(stopped?"[Compaction] End (manual aborted)":"[Compaction] End (manual error)"),error}';
      const run = payloadFunction<[object, Error, object, (message: string) => void], () => void>(
        ['globalThis', 'failure', 'signal', 'log'],
        `return()=>{${patchedFixture('compaction-manual-failed', source)}}`,
      );
      expect(
        run(
          {
            __odBlank: (_event: string, detail: Detail) => {
              events.push(detail);
            },
          },
          failure,
          { aborted },
          (message) => {
            logs.push(message);
          },
        ),
      ).toThrow(failure);
      expect(events).toEqual([{ phase: 'end', path: 'manual', outcome: 'failed' }]);
      expect(logs).toEqual([`[Compaction] End (manual ${aborted ? 'aborted' : 'error'})`]);
    },
  );
});
