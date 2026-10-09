import { describe, expect, test } from 'bun:test';
import { rmSync } from 'node:fs';

import {
  NOTE_LINE_CAP,
  SNAPSHOT_BYTE_CAP,
  TOOL_HOOKS_DONE_EVENT,
} from '../file-tracker-patches.ts';
import {
  busWithListeners,
  creditNoteOf,
  hooksWriting,
  noteOf,
  outcomeOf,
  pathOf,
  runOn,
  stamp,
  trackedBy,
  useScratchFolder,
  WRITE_RESULT,
  writeResultWith,
  writtenWith,
} from './file-tracker-harness.ts';

useScratchFolder();

const BEFORE = "const x = {a:1,b:'two'}\n";
const AFTER = "const x = { a: 1, b: 'two' };\n";
const OK = [{ exitCode: 0 }];

describe('the tool result after a PostToolUse hook changed the file', () => {
  test('a hook that rewrote the written file adds a diff and keeps the other fields', async () => {
    const tracker = writtenWith('diffed.ts', BEFORE, 'call-5');
    const path = pathOf('diffed.ts');

    const { result } = await outcomeOf({
      tracker,
      id: 'call-5',
      hooks: hooksWriting({ [path]: AFTER }, OK),
    });

    expect(result).toBe(writeResultWith(noteOf(path, BEFORE, AFTER)));
    expect(result).toContain('@@ line 1 now (were line 1) @@\\n-const x = {a:1,b:');
    expect(tracker.hasFileChangedExternally(path)).toBe(false);
  });

  test('a hook that changed nothing leaves the result byte for byte', async () => {
    const tracker = writtenWith('same.ts', BEFORE, 'call-6');
    const path = pathOf('same.ts');

    const { result } = await outcomeOf({
      tracker,
      id: 'call-6',
      hooks: hooksWriting({ [path]: BEFORE }, OK),
    });

    expect(result).toBe(WRITE_RESULT);
  });

  test('no hook ran, so no hook refresh runs and no hook done event fires', async () => {
    const tracker = writtenWith('nohook.ts', BEFORE, 'call-7');
    const path = pathOf('nohook.ts');
    const bus = busWithListeners(tracker);
    const done: string[] = [];
    bus.on(TOOL_HOOKS_DONE_EVENT, (id: string) => {
      done.push(id);
    });

    const { result } = await runOn(bus, {
      tracker,
      id: 'call-7',
      hooks: hooksWriting({ [path]: AFTER }, []),
    });

    expect(result).toBe(writeResultWith(creditNoteOf('Execute', [path])));
    expect(done).toEqual([]);
  });

  test('a plain text result gets the note after a blank line', async () => {
    const tracker = writtenWith('plain.ts', 'a\nb\n', 'call-8');
    const path = pathOf('plain.ts');

    const { result } = await outcomeOf({
      tracker,
      id: 'call-8',
      hooks: hooksWriting({ [path]: 'a\nB\n' }, OK),
      result: 'Edit applied',
    });

    expect(result).toBe(`Edit applied\n\n${noteOf(path, 'a\nb\n', 'a\nB\n')}`);
  });

  test('a result that already has a system reminder keeps it and gets the note after it', async () => {
    const tracker = writtenWith('reminded.ts', 'a\n', 'call-16');
    const path = pathOf('reminded.ts');
    const before = JSON.stringify({ success: true, systemReminder: 'IDE diagnostics' });

    const { result } = await outcomeOf({
      tracker,
      id: 'call-16',
      hooks: hooksWriting({ [path]: 'b\n' }, OK),
      result: before,
    });

    expect(result).toBe(
      JSON.stringify({
        success: true,
        systemReminder: `IDE diagnostics\n\n${noteOf(path, 'a\n', 'b\n')}`,
      }),
    );
  });

  test('an ApplyPatch result carries the note on its first file', async () => {
    const tracker = writtenWith('patched.ts', 'a\n', 'call-17');
    const path = pathOf('patched.ts');
    const files = [
      { file_path: path, display_operation: 'update' },
      { file_path: 'other.ts', display_operation: 'create' },
    ];

    const { result } = await outcomeOf({
      tracker,
      id: 'call-17',
      hooks: hooksWriting({ [path]: 'b\n' }, OK),
      result: JSON.stringify({ success: true, files }),
    });

    const [first, second] = files;
    expect(result).toBe(
      JSON.stringify({
        success: true,
        files: [{ ...first, systemReminder: noteOf(path, 'a\n', 'b\n') }, second],
      }),
    );
  });

  test('a JSON array result counts as plain text', async () => {
    const tracker = writtenWith('array.ts', 'a\n', 'call-9');
    const path = pathOf('array.ts');

    const { result } = await outcomeOf({
      tracker,
      id: 'call-9',
      hooks: hooksWriting({ [path]: 'b\n' }, OK),
      result: '[1]',
    });

    expect(result).toBe(`[1]\n\n${noteOf(path, 'a\n', 'b\n')}`);
  });

  test('a change bigger than the cap shows the cap and says how many lines are hidden', async () => {
    const lines = 50;
    const before = Array.from({ length: lines }, (_, index) => `old ${index}`).join('\n');
    const after = Array.from({ length: lines }, (_, index) => `new ${index}`).join('\n');
    const tracker = writtenWith('big.ts', before, 'call-10');
    const path = pathOf('big.ts');

    const { result } = await outcomeOf({
      tracker,
      id: 'call-10',
      hooks: hooksWriting({ [path]: after }, OK),
    });

    const note = noteOf(path, before, after).split('\n');
    const body = note.filter((line) => line.startsWith('-') || line.startsWith('+'));
    expect(body).toHaveLength(NOTE_LINE_CAP);
    expect(note.at(-1)).toBe(
      `\u2026 ${lines * 2 - NOTE_LINE_CAP} more changed lines not shown; read lines 1-${lines} before editing there.`,
    );
    expect(result).toBe(writeResultWith(note.join('\n')));
  });

  test('a file over the size cap is not snapshotted, but its mtime is still refreshed', async () => {
    const big = 'x'.repeat(SNAPSHOT_BYTE_CAP + 1);
    const tracker = writtenWith('huge.ts', big, 'call-11');
    const path = pathOf('huge.ts');

    const { result } = await outcomeOf({
      tracker,
      id: 'call-11',
      hooks: hooksWriting({ [path]: `${big}y` }, OK),
    });

    expect(result).toBe(WRITE_RESULT);
    expect(tracker.hasFileChangedExternally(path)).toBe(false);
  });

  test('a change from outside before the hooks stays external when a no-op hook runs', async () => {
    const tracker = writtenWith('outside-noop.ts', BEFORE, 'call-18');
    const path = pathOf('outside-noop.ts');
    stamp(path, 'someone else wrote this\n', 15);

    const { result } = await outcomeOf({
      tracker,
      id: 'call-18',
      hooks: hooksWriting({}, OK),
    });

    expect(result).toBe(WRITE_RESULT);
    expect(tracker.hasFileChangedExternally(path)).toBe(true);
  });

  test('a change from outside before the hooks stays external when the hook reformats', async () => {
    const tracker = writtenWith('outside-fmt.ts', BEFORE, 'call-19');
    const path = pathOf('outside-fmt.ts');
    stamp(path, 'someone else wrote this\n', 15);

    const { result } = await outcomeOf({
      tracker,
      id: 'call-19',
      hooks: hooksWriting({ [path]: 'someone else wrote this;\n' }, OK),
    });

    expect(result).toBe(WRITE_RESULT);
    expect(tracker.hasFileChangedExternally(path)).toBe(true);
  });

  test('a stale file over the size cap stays external too', async () => {
    const big = 'x'.repeat(SNAPSHOT_BYTE_CAP + 1);
    const tracker = writtenWith('outside-huge.ts', big, 'call-20');
    const path = pathOf('outside-huge.ts');
    stamp(path, `${big}y`, 15);

    await outcomeOf({ tracker, id: 'call-20', hooks: hooksWriting({}, OK) });

    expect(tracker.hasFileChangedExternally(path)).toBe(true);
  });

  test('a file exactly at the size cap is snapshotted', async () => {
    const edge = 'x'.repeat(SNAPSHOT_BYTE_CAP);
    const tracker = writtenWith('edge.ts', edge, 'call-12');
    const path = pathOf('edge.ts');

    const { result } = await outcomeOf({
      tracker,
      id: 'call-12',
      hooks: hooksWriting({ [path]: `${edge}y` }, OK),
    });

    expect(result).toBe(writeResultWith(noteOf(path, edge, `${edge}y`)));
  });

  test('files of another call and files only read get no diff note, only the credit note', async () => {
    const mine = pathOf('quiet-mine.ts');
    const theirs = pathOf('quiet-theirs.ts');
    const seen = pathOf('quiet-seen.ts');
    const tracker = trackedBy([
      [stamp(mine, 'm\n', 10), 'call-13', 'edit'],
      [stamp(theirs, 't\n', 10), 'call-other', 'edit'],
      [stamp(seen, 's\n', 10), 'call-13', 'read'],
    ]);

    const { result } = await outcomeOf({
      tracker,
      id: 'call-13',
      hooks: hooksWriting({ [mine]: 'm\n', [theirs]: 'T\n', [seen]: 'S\n' }, OK),
    });

    expect(result).toBe(writeResultWith(creditNoteOf('Execute', [theirs, seen])));
  });

  test('a file the hook deleted gets no note and does not fail the call', async () => {
    const tracker = writtenWith('gone.ts', BEFORE, 'call-14');
    const path = pathOf('gone.ts');

    const { result } = await outcomeOf({
      tracker,
      id: 'call-14',
      hooks: async () => {
        await Bun.sleep(0);
        rmSync(path);
        return OK;
      },
    });

    expect(result).toBe(WRITE_RESULT);
  });

  test('two files changed by one call give two notes', async () => {
    const first = pathOf('two-a.ts');
    const second = pathOf('two-b.ts');
    const tracker = trackedBy([
      [stamp(first, 'a\n', 10), 'call-15', 'edit'],
      [stamp(second, 'b\n', 10), 'call-15', 'edit'],
    ]);

    const { result } = await outcomeOf({
      tracker,
      id: 'call-15',
      hooks: hooksWriting({ [first]: 'A\n', [second]: 'B\n' }, OK),
    });

    const notes = [noteOf(first, 'a\n', 'A\n'), noteOf(second, 'b\n', 'B\n')];
    expect(result).toBe(writeResultWith(notes.join('\n\n')));
  });
});

const INTRO =
  'A PostToolUse hook changed f.ts after this write. Droid recorded the new contents, so you can edit it without reading it again. Edit from these lines, not from what you wrote:';

describe('the line diff note', () => {
  const hunk = (header: string, ...body: string[]): string => [INTRO, header, ...body].join('\n');

  test('identical texts give no note', () => {
    expect(noteOf('f.ts', 'a\nb\n', 'a\nb\n')).toBe('');
  });

  test('an insertion only shows the added lines', () => {
    expect(noteOf('f.ts', 'a\nb\n', 'a\nx\nb\n')).toBe(
      hunk('@@ line 2 now (were no lines after line 1) @@', '+x'),
    );
  });

  test('a deletion only shows the removed lines', () => {
    expect(noteOf('f.ts', 'a\nx\nb\n', 'a\nb\n')).toBe(
      hunk('@@ no lines after line 1 now (were line 2) @@', '-x'),
    );
  });

  test('a change on the first line', () => {
    expect(noteOf('f.ts', 'a\nb', 'z\nb')).toBe(hunk('@@ line 1 now (were line 1) @@', '-a', '+z'));
  });

  test('a change on the last line', () => {
    expect(noteOf('f.ts', 'a\nb', 'a\nz')).toBe(hunk('@@ line 2 now (were line 2) @@', '-b', '+z'));
  });

  test('a change that grows a span reports both ranges', () => {
    expect(noteOf('f.ts', 'a\nb\nc', 'a\nx\ny\nz\nc')).toBe(
      hunk('@@ lines 2-4 now (were line 2) @@', '-b', '+x', '+y', '+z'),
    );
  });

  test('a missing final newline is a change of its own', () => {
    expect(noteOf('f.ts', 'a\n', 'a')).toBe(
      hunk('@@ no lines after line 1 now (were line 2) @@', '-'),
    );
  });

  test('a repeated line is inserted at the end of the run', () => {
    expect(noteOf('f.ts', 'a\na', 'a\na\na')).toBe(
      hunk('@@ line 3 now (were no lines after line 2) @@', '+a'),
    );
  });
});
