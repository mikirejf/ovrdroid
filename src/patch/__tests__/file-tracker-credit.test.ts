import { describe, expect, test } from 'bun:test';
import { rmSync } from 'node:fs';

import {
  creditNoteOf,
  NO_HOOKS,
  outcomeOf,
  pathOf,
  stamp,
  trackedBy,
  trackedFile,
  useScratchFolder,
  writing,
  WRITE_RESULT,
  writeResultWith,
} from './file-tracker-harness.ts';

useScratchFolder();

describe('crediting a tool call with the files it changed', () => {
  test('a file the call changed counts as the call own change and is named in the note', async () => {
    const { path, tracker } = trackedFile('shell-edited.ts', 'edit');

    const { result } = await outcomeOf({
      tracker,
      id: 'call-1',
      hooks: NO_HOOKS,
      tool: writing({ [path]: 'sed -i was here\n' }),
    });

    expect(tracker.hasFileChangedExternally(path)).toBe(false);
    expect(result).toBe(writeResultWith(creditNoteOf('Execute', [path])));
  });

  test('the credit keeps the operation and takes the id of the call', async () => {
    const { path, tracker } = trackedFile('read-then-changed.ts', 'read');

    await outcomeOf({
      tracker,
      id: 'call-2',
      hooks: NO_HOOKS,
      tool: writing({ [path]: 'changed\n' }),
    });

    expect(tracker.fileTimestamps.get(path)).toMatchObject({
      toolCallId: 'call-2',
      operation: 'read',
    });
  });

  test('the note names the tool that ran', async () => {
    const { path, tracker } = trackedFile('by-subagent.ts');

    const { result } = await outcomeOf({
      tracker,
      id: 'call-3',
      name: 'Task',
      hooks: NO_HOOKS,
      tool: writing({ [path]: 'subagent\n' }),
    });

    expect(result).toContain('This Task call changed files you read or wrote earlier: ');
  });

  test('a file changed before the call stays flagged and is not listed', async () => {
    const { path, tracker } = trackedFile('outside-before.ts', 'edit');
    stamp(path, 'someone else\n', 15);

    const { result } = await outcomeOf({ tracker, id: 'call-4', hooks: NO_HOOKS });

    expect(tracker.hasFileChangedExternally(path)).toBe(true);
    expect(result).toBe(WRITE_RESULT);
  });

  test('a file stale before the call stays flagged and is not listed even when the call changes it again', async () => {
    const { path, tracker } = trackedFile('stale-then-changed.ts', 'edit');
    stamp(path, 'someone else\n', 15);

    const { result } = await outcomeOf({
      tracker,
      id: 'call-5',
      hooks: NO_HOOKS,
      tool: writing({ [path]: 'and the call\n' }),
    });

    expect(result).toBe(WRITE_RESULT);
    expect(tracker.hasFileChangedExternally(path)).toBe(true);
  });

  test('accepted miss: another tool re-tracked the file during the call and this call then changed it again, so it stays flagged', async () => {
    const { path, tracker } = trackedFile('retracked-then-changed.ts', 'edit');

    const { result } = await outcomeOf({
      tracker,
      id: 'call-5b',
      hooks: NO_HOOKS,
      tool: () => {
        stamp(path, 'parallel edit\n', 20);
        tracker.track(path, 'call-parallel', 'edit');
        stamp(path, 'and this call\n', 25);
      },
    });

    expect(result).toBe(WRITE_RESULT);
    expect(tracker.hasFileChangedExternally(path)).toBe(true);
  });

  test('a stale file and a file changed by the call: only the second is credited', async () => {
    const stale = stamp(pathOf('mixed-stale.ts'), 'a\n', 10);
    const fresh = stamp(pathOf('mixed-fresh.ts'), 'b\n', 10);
    const tracker = trackedBy([
      [stale, 'call-earlier', 'edit'],
      [fresh, 'call-earlier', 'edit'],
    ]);
    stamp(stale, 'someone else\n', 15);

    const { result } = await outcomeOf({
      tracker,
      id: 'call-6',
      hooks: NO_HOOKS,
      tool: writing({ [fresh]: 'call\n' }),
    });

    expect(tracker.hasFileChangedExternally(stale)).toBe(true);
    expect(tracker.hasFileChangedExternally(fresh)).toBe(false);
    expect(result).toBe(writeResultWith(creditNoteOf('Execute', [fresh])));
  });

  test('a file the tool already re-tracked itself is not listed', async () => {
    const { path, tracker } = trackedFile('own-edit.ts', 'edit');

    const { result } = await outcomeOf({
      tracker,
      id: 'call-7',
      hooks: NO_HOOKS,
      tool: () => {
        stamp(path, 'edited\n', 20);
        tracker.track(path, 'call-7', 'edit');
      },
    });

    expect(result).toBe(WRITE_RESULT);
    expect(tracker.hasFileChangedExternally(path)).toBe(false);
  });

  test('a file the call changed but nobody tracked is ignored', async () => {
    const { tracker } = trackedFile('tracked-bystander.ts');
    const loose = pathOf('untracked.ts');

    const { result } = await outcomeOf({
      tracker,
      id: 'call-8',
      hooks: NO_HOOKS,
      tool: writing({ [loose]: 'new file\n' }),
    });

    expect(result).toBe(WRITE_RESULT);
    expect([...tracker.fileTimestamps.keys()]).toEqual([pathOf('tracked-bystander.ts')]);
  });

  test('a tracked file the call deleted gives no note and does not fail the call', async () => {
    const { path, tracker } = trackedFile('deleted-by-call.ts', 'edit');

    const { result } = await outcomeOf({
      tracker,
      id: 'call-9',
      hooks: NO_HOOKS,
      tool: () => {
        rmSync(path);
      },
    });

    expect(result).toBe(WRITE_RESULT);
  });

  test('a tracked file that is already missing before the call does not fail it', async () => {
    const { path, tracker } = trackedFile('missing-before.ts', 'edit');
    rmSync(path);

    const { result } = await outcomeOf({ tracker, id: 'call-10', hooks: NO_HOOKS });

    expect(result).toBe(WRITE_RESULT);
  });

  test('a call that changed nothing leaves the result byte for byte', async () => {
    const { tracker } = trackedFile('untouched.ts', 'edit');

    const { result } = await outcomeOf({ tracker, id: 'call-11', hooks: NO_HOOKS });

    expect(result).toBe(WRITE_RESULT);
  });

  test('a file recreated by the call counts as changed by the call', async () => {
    const { path, tracker } = trackedFile('recreated.ts', 'edit');
    rmSync(path);

    const { result } = await outcomeOf({
      tracker,
      id: 'call-12',
      hooks: NO_HOOKS,
      tool: writing({ [path]: 'back\n' }),
    });

    expect(tracker.hasFileChangedExternally(path)).toBe(false);
    expect(result).toBe(writeResultWith(creditNoteOf('Execute', [path])));
  });
});
