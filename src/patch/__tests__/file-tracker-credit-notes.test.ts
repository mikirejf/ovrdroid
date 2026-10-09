import { describe, expect, test } from 'bun:test';

import { CREDIT_PATH_CAP } from '../file-tracker-patches.ts';
import type { FakeTracker, Tool } from './file-tracker-harness.ts';
import {
  creditNoteOf,
  hooksWriting,
  HOOKS_OK,
  noteOf,
  NO_HOOKS,
  outcomeOf,
  pathOf,
  stamp,
  trackedBy,
  trackedFile,
  useScratchFolder,
  writing,
  writeResultWith,
} from './file-tracker-harness.ts';

useScratchFolder();

describe('the credit note in the tool result', () => {
  test('a plain text result gets the note after a blank line', async () => {
    const { path, tracker } = trackedFile('plain-text.ts');

    const { result } = await outcomeOf({
      tracker,
      id: 'call-13',
      hooks: NO_HOOKS,
      result: 'exit 0',
      tool: writing({ [path]: 'x\n' }),
    });

    expect(result).toBe(`exit 0\n\n${creditNoteOf('Execute', [path])}`);
  });

  test('a JSON array result counts as plain text', async () => {
    const { path, tracker } = trackedFile('json-array.ts');

    const { result } = await outcomeOf({
      tracker,
      id: 'call-14',
      hooks: NO_HOOKS,
      result: '[1]',
      tool: writing({ [path]: 'x\n' }),
    });

    expect(result).toBe(`[1]\n\n${creditNoteOf('Execute', [path])}`);
  });

  test('a result that already has a system reminder keeps it and gets the note after it', async () => {
    const { path, tracker } = trackedFile('reminded.ts');

    const { result } = await outcomeOf({
      tracker,
      id: 'call-15',
      hooks: NO_HOOKS,
      result: JSON.stringify({ success: true, systemReminder: 'IDE diagnostics' }),
      tool: writing({ [path]: 'x\n' }),
    });

    expect(result).toBe(
      JSON.stringify({
        success: true,
        systemReminder: `IDE diagnostics\n\n${creditNoteOf('Execute', [path])}`,
      }),
    );
  });

  test('a result with a file list carries the note on its first file', async () => {
    const { path, tracker } = trackedFile('file-list.ts');
    const files = [{ file_path: 'a.ts' }, { file_path: 'b.ts' }];

    const { result } = await outcomeOf({
      tracker,
      id: 'call-16',
      hooks: NO_HOOKS,
      result: JSON.stringify({ success: true, files }),
      tool: writing({ [path]: 'x\n' }),
    });

    expect(result).toBe(
      JSON.stringify({
        success: true,
        files: [{ ...files[0], systemReminder: creditNoteOf('Execute', [path]) }, files[1]],
      }),
    );
  });

  test('a credited file is not read by the hooks snapshot and gets no hook diff note', async () => {
    const { path, tracker } = trackedFile('credited-then-formatted.ts', 'edit');
    const reads: string[] = [];

    const { result } = await outcomeOf({
      tracker,
      id: 'call-17',
      hooks: hooksWriting({ [path]: 'sed was here;\n' }, HOOKS_OK),
      tool: writing({ [path]: 'sed was here\n' }, 15),
      reads,
    });

    expect(reads).toEqual([]);
    expect(result).toBe(writeResultWith(creditNoteOf('Execute', [path])));
    expect(tracker.hasFileChangedExternally(path)).toBe(false);
  });

  test('a hook that rewrites a tracked file the tool did not write gets that file credited and listed', async () => {
    const { path, tracker } = trackedFile('hook-touched.ts', 'edit');

    const { result } = await outcomeOf({
      tracker,
      id: 'call-22',
      name: 'Write',
      hooks: hooksWriting({ [path]: 'formatted\n' }, HOOKS_OK),
    });

    expect(result).toBe(writeResultWith(creditNoteOf('Write', [path])));
    expect(tracker.hasFileChangedExternally(path)).toBe(false);
  });

  test('the hook diff note comes first and the credit note last', async () => {
    const written = stamp(pathOf('order-written.ts'), 'a\n', 10);
    const shelled = stamp(pathOf('order-shelled.ts'), 'b\n', 10);
    const tracker = trackedBy([
      [written, 'call-23', 'edit'],
      [shelled, 'call-earlier', 'read'],
    ]);

    const { result } = await outcomeOf({
      tracker,
      id: 'call-23',
      hooks: hooksWriting({ [written]: 'A\n' }, HOOKS_OK),
      tool: writing({ [shelled]: 'B\n' }, 15),
    });

    const notes = [noteOf(written, 'a\n', 'A\n'), creditNoteOf('Execute', [shelled])];
    expect(result).toBe(writeResultWith(notes.join('\n\n')));
  });

  test('a hook that ran but changed nothing adds no second note', async () => {
    const { path, tracker } = trackedFile('credited-hook-noop.ts', 'edit');

    const { result } = await outcomeOf({
      tracker,
      id: 'call-18',
      hooks: hooksWriting({}, HOOKS_OK),
      tool: writing({ [path]: 'x\n' }),
    });

    expect(result).toBe(writeResultWith(creditNoteOf('Execute', [path])));
  });

  test('a hook rewrite of a file the call did not touch gets no credit note', async () => {
    const mine = stamp(pathOf('hook-only.ts'), 'before\n', 10);
    const tracker = trackedBy([[mine, 'call-19', 'edit']]);

    const { result } = await outcomeOf({
      tracker,
      id: 'call-19',
      hooks: hooksWriting({ [mine]: 'formatted\n' }, HOOKS_OK),
    });

    expect(result).toBe(writeResultWith(noteOf(mine, 'before\n', 'formatted\n')));
  });
});

function manyNames(count: number): string[] {
  return Array.from({ length: count }, (_, index) => `many-${count}-${index}.ts`);
}

interface TrackedMany {
  paths: string[];
  tracker: FakeTracker;
}

function trackedMany(count: number): TrackedMany {
  const paths = manyNames(count).map((name) => stamp(pathOf(name), name, 10));
  return { paths, tracker: trackedBy(paths.map((path) => [path, 'call-earlier', 'read'])) };
}

function changingAll(paths: readonly string[]): Tool {
  return writing(Object.fromEntries(paths.map((path) => [path, 'changed\n'])));
}

describe('the list of credited files', () => {
  test('twenty files are all listed', async () => {
    const { paths, tracker } = trackedMany(CREDIT_PATH_CAP);

    const { result } = await outcomeOf({
      tracker,
      id: 'call-20',
      hooks: NO_HOOKS,
      tool: changingAll(paths),
    });

    const note = creditNoteOf('Execute', paths);
    expect(result).toBe(writeResultWith(note));
    expect(note).toContain(`${paths.join(', ')}. Droid recorded`);
  });

  test('more than twenty files list twenty, say how many are left, and credit every file', async () => {
    const { paths, tracker } = trackedMany(CREDIT_PATH_CAP + 3);

    const { result } = await outcomeOf({
      tracker,
      id: 'call-21',
      hooks: NO_HOOKS,
      tool: changingAll(paths),
    });

    const note = creditNoteOf('Execute', paths);
    expect(result).toBe(writeResultWith(note));
    expect(note).toContain(
      `${paths.slice(0, CREDIT_PATH_CAP).join(', ')}, \u2026 and 3 more. Droid recorded`,
    );
    expect(note).not.toContain(paths.slice(CREDIT_PATH_CAP).join(', '));
    expect(paths.filter((path) => tracker.hasFileChangedExternally(path))).toEqual([]);
  });

  test('the note reads as plain English', () => {
    expect(creditNoteOf('Execute', ['/a.ts', '/b.ts'])).toBe(
      'This Execute call changed files you read or wrote earlier: /a.ts, /b.ts. Droid recorded their new versions, so Edit accepts them. Your earlier view of them is out of date: read the changed part first unless you know what changed.',
    );
  });
});
