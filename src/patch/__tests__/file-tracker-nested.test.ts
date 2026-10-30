import { describe, expect, test } from 'bun:test';

import {
  creditNoteOf,
  stamp,
  trackedFile,
  useScratchFolder,
  WRITE_RESULT,
} from './file-tracker-harness.ts';
import type { Build, NestedResult } from './file-tracker-nested-harness.ts';
import { nestedOn } from './file-tracker-nested-harness.ts';
import { failureOf } from './payload.ts';
import { stockDroid } from './stock-scanner.ts';

useScratchFolder();

function scriptOn(build: Build, name: string) {
  const { path, tracker } = trackedFile(`${build}-${name}`, 'read');
  return { path, tracker, ...nestedOn(build, tracker) };
}

async function editThenFormat(build: Build) {
  const { path, tracker, nested, script } = scriptOn(build, 'formatted.ts');
  let formatted: NestedResult | undefined;
  const outer = await script(async () => {
    await nested('edit-1', 'Edit', { path, text: 'edited\n', at: 20 });
    formatted = await nested('format-1', 'Execute', { files: { [path]: 'formatted\n' }, at: 30 });
  });
  return { path, tracker, formatted, outer };
}

describe.skipIf(stockDroid === undefined)('tool calls inside a Script', () => {
  test('stock leaves a file a nested Execute rewrote after a nested Edit flagged as changed', async () => {
    const { path, tracker, formatted, outer } = await editThenFormat('stock');

    expect(tracker.hasFileChangedExternally(path)).toBe(true);
    expect(formatted?.llmReminders).toBeUndefined();
    expect(outer.result).toBe(WRITE_RESULT);
  });

  test('the patch credits that rewrite to the nested Execute, once', async () => {
    const { path, tracker, formatted, outer } = await editThenFormat('patched');

    expect(tracker.hasFileChangedExternally(path)).toBe(false);
    expect(tracker.fileTimestamps.get(path)).toMatchObject({ toolCallId: 'format-1' });
    expect(formatted?.llmReminders).toEqual([creditNoteOf('Execute', [path])]);
    expect(outer.result).toBe(WRITE_RESULT);
  });

  test('stock refuses a nested Edit on a file a nested Execute changed earlier in the Script', async () => {
    const { path, nested, script } = scriptOn('stock', 'shell-then-edit.ts');
    let refusal = '';

    await script(async () => {
      await nested('sed-1', 'Execute', { files: { [path]: 'sed\n' }, at: 20 });
      refusal = await failureOf(nested('edit-2', 'Edit', { path, text: 'edited\n', at: 30 }));
    });

    expect(refusal).toContain('modified externally');
  });

  test('the patch lets that nested Edit through', async () => {
    const { path, tracker, nested, script } = scriptOn('patched', 'shell-then-edit.ts');
    let edited: NestedResult | undefined;

    const outer = await script(async () => {
      await nested('sed-1', 'Execute', { files: { [path]: 'sed\n' }, at: 20 });
      edited = await nested('edit-2', 'Edit', { path, text: 'edited\n', at: 30 });
    });

    expect(edited?.content).toBe('edited');
    expect(tracker.hasFileChangedExternally(path)).toBe(false);
    expect(outer.result).toBe(WRITE_RESULT);
  });

  test.each(['stock', 'patched'] as const)(
    'a background Script on %s: its nested calls run after the outer call returned',
    async (build) => {
      const { path, tracker, nested, script } = scriptOn(build, 'background.ts');

      const outer = await script(async () => {});
      const ran = await nested('bg-1', 'Execute', { files: { [path]: 'later\n' }, at: 20 });

      expect(outer.result).toBe(WRITE_RESULT);
      expect(tracker.hasFileChangedExternally(path)).toBe(build === 'stock');
      expect(ran.llmReminders).toEqual(
        build === 'stock' ? undefined : [creditNoteOf('Execute', [path])],
      );
    },
  );

  test('a file changed before the nested call stays flagged and is not credited', async () => {
    const { path, tracker, nested, script } = scriptOn('patched', 'stale-before.ts');
    stamp(path, 'someone else\n', 15);
    let ran: NestedResult | undefined;

    await script(async () => {
      ran = await nested('exec-3', 'Execute', { files: { [path]: 'and the call\n' }, at: 20 });
    });

    expect(tracker.hasFileChangedExternally(path)).toBe(true);
    expect(ran?.llmReminders).toBeUndefined();
  });
});
