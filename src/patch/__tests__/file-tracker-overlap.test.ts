import { describe, expect, test } from 'bun:test';

import {
  busWithListeners,
  creditNoteOf,
  NO_HOOKS,
  pathOf,
  runOn,
  stamp,
  trackedBy,
  trackedFile,
  useScratchFolder,
  WRITE_RESULT,
  writeResultWith,
} from './file-tracker-harness.ts';
import type { Tool } from './file-tracker-harness.ts';
import type { Build, NestedResult } from './file-tracker-nested-harness.ts';
import { nestedOn } from './file-tracker-nested-harness.ts';
import { failureOf } from './payload.ts';
import { stockDroid } from './stock-scanner.ts';

useScratchFolder();

function remindersOf(...results: (NestedResult | undefined)[]): string[] {
  return results.flatMap((result) => result?.llmReminders ?? []);
}

async function readerAndWriter(build: Build) {
  const { path, tracker } = trackedFile(`${build}-overlap.ts`, 'read');
  const { nested, script } = nestedOn(build, tracker);
  const wrote = Promise.withResolvers<null>();
  const readerDone = Promise.withResolvers<null>();
  let reader: NestedResult | undefined;
  let writer: NestedResult | undefined;
  const outer = await script(async () => {
    [writer, reader] = await Promise.all([
      nested('write-1', 'Execute', {
        files: { [path]: 'rewritten\n' },
        at: 20,
        onWrote: () => {
          wrote.resolve(null);
        },
        waitAfter: readerDone.promise,
      }),
      nested('read-1', 'Execute', { waitBefore: wrote.promise }).finally(() => {
        readerDone.resolve(null);
      }),
    ]);
  });
  return { path, tracker, reader, writer, outer };
}

describe.skipIf(stockDroid === undefined)('nested calls that overlap', () => {
  test('stock: neither nested call says anything, and the Script fallback credits the file', async () => {
    const { path, tracker, reader, writer, outer } = await readerAndWriter('stock');

    expect(remindersOf(reader, writer)).toEqual([]);
    expect(outer.result).toBe(writeResultWith(creditNoteOf('Script', [path])));
    expect(tracker.hasFileChangedExternally(path)).toBe(false);
  });

  test('a read-only call that finished while a writer still ran does not claim the write alone', async () => {
    const { path, tracker, reader, writer, outer } = await readerAndWriter('patched');

    expect(remindersOf(reader, writer)).toEqual([creditNoteOf('Execute', [path], true)]);
    expect(remindersOf(reader, writer).join('')).toContain(
      'This Execute call, or a tool call that ran at the same time, changed files you read or wrote earlier: ',
    );
    expect(tracker.hasFileChangedExternally(path)).toBe(false);
    expect(outer.result).toBe(WRITE_RESULT);
  });

  test('two writers to different files: every note is shared and both files are credited', async () => {
    const first = stamp(pathOf('writer-a.ts'), 'a\n', 10);
    const second = stamp(pathOf('writer-b.ts'), 'b\n', 10);
    const tracker = trackedBy([
      [first, 'call-earlier', 'read'],
      [second, 'call-earlier', 'read'],
    ]);
    const { nested, script } = nestedOn('patched', tracker);
    const firstWrote = Promise.withResolvers<null>();
    const secondWrote = Promise.withResolvers<null>();
    let results: NestedResult[] = [];

    await script(async () => {
      results = await Promise.all([
        nested('write-a', 'Execute', {
          files: { [first]: 'a2\n' },
          at: 20,
          onWrote: () => {
            firstWrote.resolve(null);
          },
          waitAfter: secondWrote.promise,
        }),
        nested('write-b', 'Execute', {
          files: { [second]: 'b2\n' },
          at: 20,
          onWrote: () => {
            secondWrote.resolve(null);
          },
          waitAfter: firstWrote.promise,
        }),
      ]);
    });

    const notes = remindersOf(...results);
    expect(notes.length).toBeGreaterThan(0);
    for (const note of notes) {
      expect(note).toContain(', or a tool call that ran at the same time, ');
    }
    expect(notes.join('')).toContain(first);
    expect(notes.join('')).toContain(second);
    expect(tracker.hasFileChangedExternally(first)).toBe(false);
    expect(tracker.hasFileChangedExternally(second)).toBe(false);
  });

  test('a call that threw while another ran leaves no record, so a later call writes alone', async () => {
    const { path, tracker } = trackedFile('after-throw.ts', 'read');
    const { nested, script } = nestedOn('patched', tracker);
    const threw = Promise.withResolvers<null>();
    let failure = '';
    let later: NestedResult | undefined;

    await script(async () => {
      await Promise.all([
        (async () => {
          failure = await failureOf(nested('fail-1', 'Execute', { fails: 'exit 1' }));
          threw.resolve(null);
        })(),
        nested('wait-1', 'Execute', { waitBefore: threw.promise }),
      ]);
      later = await nested('write-2', 'Execute', { files: { [path]: 'later\n' }, at: 20 });
    });

    expect(failure).toBe('exit 1');
    expect(later?.llmReminders).toEqual([creditNoteOf('Execute', [path])]);
  });
});

function concurrentWrite(
  path: string,
  wrote: PromiseWithResolvers<null>,
  until: Promise<unknown>,
): Tool {
  return async () => {
    stamp(path, 'written by the overlapping call\n', 20);
    wrote.resolve(null);
    await until;
  };
}

describe('top-level calls that overlap', () => {
  test('a read-only call that finished while a Task still ran does not claim the Task write alone', async () => {
    const { path, tracker } = trackedFile('top-overlap.ts', 'read');
    const bus = busWithListeners(tracker);
    const wrote = Promise.withResolvers<null>();
    const readerDone = Promise.withResolvers<null>();

    const [task, reader] = await Promise.all([
      runOn(bus, {
        tracker,
        id: 'task-1',
        name: 'Task',
        hooks: NO_HOOKS,
        tool: concurrentWrite(path, wrote, readerDone.promise),
      }),
      runOn(bus, {
        tracker,
        id: 'grep-1',
        name: 'Execute',
        hooks: NO_HOOKS,
        tool: async () => {
          await wrote.promise;
        },
      }).finally(() => {
        readerDone.resolve(null);
      }),
    ]);

    expect(reader.result).toBe(writeResultWith(creditNoteOf('Execute', [path], true)));
    expect(task.result).toBe(WRITE_RESULT);
    expect(tracker.hasFileChangedExternally(path)).toBe(false);
  });

  test('a top-level Script running alongside does not make a call shared', async () => {
    const { path, tracker } = trackedFile('beside-script.ts', 'read');
    const bus = busWithListeners(tracker);
    const writerDone = Promise.withResolvers<null>();
    const scriptStarted = Promise.withResolvers<null>();

    const [, writer] = await Promise.all([
      runOn(bus, {
        tracker,
        id: 'script-2',
        name: 'Script',
        hooks: NO_HOOKS,
        tool: async () => {
          scriptStarted.resolve(null);
          await writerDone.promise;
        },
      }),
      runOn(bus, {
        tracker,
        id: 'task-2',
        name: 'Task',
        hooks: NO_HOOKS,
        tool: async () => {
          await scriptStarted.promise;
          stamp(path, 'task\n', 20);
        },
      }).finally(() => {
        writerDone.resolve(null);
      }),
    ]);

    expect(writer.result).toBe(writeResultWith(creditNoteOf('Task', [path])));
  });

  test('a top-level call that threw leaves no record behind', async () => {
    const { path, tracker } = trackedFile('top-after-throw.ts', 'read');
    const bus = busWithListeners(tracker);
    const failure = await failureOf(
      runOn(bus, {
        tracker,
        id: 'fail-2',
        name: 'Execute',
        hooks: NO_HOOKS,
        tool: () => {
          throw new Error('boom');
        },
      }),
    );

    const later = await runOn(bus, {
      tracker,
      id: 'exec-later',
      name: 'Execute',
      hooks: NO_HOOKS,
      tool: () => {
        stamp(path, 'later\n', 20);
      },
    });

    expect(failure).toBe('boom');
    expect(later.result).toBe(writeResultWith(creditNoteOf('Execute', [path])));
  });
});
