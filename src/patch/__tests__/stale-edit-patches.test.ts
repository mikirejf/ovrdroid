import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';

import { STALE_EDIT_NOTE, staleEditPatches } from '../stale-edit-patches.ts';
import { stamp, trackedFile, useScratchFolder } from './file-tracker-harness.ts';
import { describeStrayNames } from './payload.ts';
import { stockEdit } from './stale-edit-harness.ts';

useScratchFolder();

const STOCK_ORIGINAL = 'alpha = 1\nbeta = 2\ngamma = 3\ndelta = 4\n';

function readAs(name: string, text = STOCK_ORIGINAL) {
  const { path, tracker } = trackedFile(name);
  stamp(path, text, 10);
  tracker.track(path, 'read-call', 'read');
  return { path, tracker, edit: stockEdit(tracker) };
}

function noteOf(value: string | undefined): string | undefined {
  const parsed: unknown = JSON.parse(value ?? '{}');
  if (typeof parsed === 'object' && parsed !== null && 'systemReminder' in parsed) {
    return typeof parsed.systemReminder === 'string' ? parsed.systemReminder : undefined;
  }
  return undefined;
}

describe('the patches', () => {
  test('each anchors exactly once on the stock shape the tests run against', () => {
    expect(() => stockEdit(readAs('shape.ts').tracker)).not.toThrow();
  });
});

describe('an Edit on a file that changed since it was read', () => {
  test('applies when old_str still matches once, keeps the outside change and says so', async () => {
    const { path, tracker, edit } = readAs('elsewhere.ts');
    stamp(path, 'alpha = 1\nbeta = 2\ngamma = 3\ndelta = 40\n', 15);
    expect(tracker.hasFileChangedExternally(path)).toBe(true);

    const reply = await edit.edit({ path, old: 'alpha = 1', replacement: 'alpha = 10' });

    expect(reply.isError).toBe(false);
    expect(readFileSync(path, 'utf-8')).toBe('alpha = 10\nbeta = 2\ngamma = 3\ndelta = 40\n');
    expect(noteOf(reply.value)).toBe(STALE_EDIT_NOTE);
    expect(tracker.hasFileChangedExternally(path)).toBe(false);
  });

  test('keeps a reminder the Edit already carried and adds the note after it', async () => {
    const { path, edit } = readAs('reminder.ts');
    stamp(path, 'alpha = 1\nbeta = 2\ngamma = 3\ndelta = 40\n', 15);

    const reply = await edit.edit({
      path,
      old: 'alpha = 1',
      replacement: 'alpha = 10',
      ideReminder: 'ide says hello',
    });

    expect(noteOf(reply.value)).toBe(`ide says hello\n\n${STALE_EDIT_NOTE}`);
  });

  test('refuses as stock does when the outside change removed old_str, and writes nothing', async () => {
    const { path, edit } = readAs('removed.ts');
    const outside = 'alpha = 7\nbeta = 2\ngamma = 3\ndelta = 4\n';
    stamp(path, outside, 15);

    const reply = await edit.edit({ path, old: 'alpha = 1', replacement: 'alpha = 10' });

    expect(reply.isError).toBe(true);
    expect(reply.llmError).toContain('has been modified externally since it was last read');
    expect(readFileSync(path, 'utf-8')).toBe(outside);
  });

  test('refuses as stock does when the outside change made old_str appear twice, and writes nothing', async () => {
    const { path, edit } = readAs('twice.ts');
    const outside = `${STOCK_ORIGINAL}alpha = 1\n`;
    stamp(path, outside, 15);

    const reply = await edit.edit({ path, old: 'alpha = 1', replacement: 'alpha = 10' });

    expect(reply.isError).toBe(true);
    expect(reply.llmError).toContain('has been modified externally since it was last read');
    expect(readFileSync(path, 'utf-8')).toBe(outside);
  });

  test('refuses with change_all even when old_str matches once', async () => {
    const { path, edit } = readAs('change-all.ts');
    const outside = 'alpha = 1\nbeta = 2\ngamma = 3\ndelta = 40\n';
    stamp(path, outside, 15);

    const reply = await edit.edit({
      path,
      old: 'alpha = 1',
      replacement: 'alpha = 10',
      changeAll: true,
    });

    expect(reply.isError).toBe(true);
    expect(reply.llmError).toContain('has been modified externally');
    expect(readFileSync(path, 'utf-8')).toBe(outside);
  });

  test('refuses an empty old_str', async () => {
    const { path, edit } = readAs('empty.ts');
    stamp(path, 'x\n', 15);

    const reply = await edit.edit({ path, old: '', replacement: 'y' });

    expect(reply.isError).toBe(true);
    expect(reply.llmError).toContain('has been modified externally');
  });

  test('the next Edit in the same file applies with no note and no refusal', async () => {
    const { path, edit } = readAs('twice-in-a-row.ts');
    stamp(path, 'alpha = 1\nbeta = 2\ngamma = 3\ndelta = 40\n', 15);
    await edit.edit({ path, old: 'alpha = 1', replacement: 'alpha = 10' });

    const second = await edit.edit({ path, old: 'gamma = 3', replacement: 'gamma = 30' });

    expect(second.isError).toBe(false);
    expect(noteOf(second.value)).toBeUndefined();
    expect(readFileSync(path, 'utf-8')).toBe('alpha = 10\nbeta = 2\ngamma = 30\ndelta = 40\n');
  });

  test('an Edit on a file nobody changed carries no note', async () => {
    const { path, edit } = readAs('untouched.ts');

    const reply = await edit.edit({ path, old: 'beta = 2', replacement: 'beta = 20' });

    expect(reply.isError).toBe(false);
    expect(noteOf(reply.value)).toBeUndefined();
  });

  test('a file nobody changed still fails the many-matches check as stock does', async () => {
    const { path, edit } = readAs('plain.ts', 'one\none\n');

    const reply = await edit.edit({ path, old: 'one', replacement: 'two' });

    expect(reply.isError).toBe(true);
    expect(reply.llmError).toContain('Found 2 occurrences');
  });
});

describe('the file check without a tolerance callback, as ApplyPatch calls it', () => {
  test('still refuses a file that changed since it was read', async () => {
    const { path, edit } = readAs('apply-patch.ts');
    stamp(path, 'alpha = 1\nbeta = 2\ngamma = 3\ndelta = 40\n', 15);

    const verdict = await edit.check(path);

    expect(verdict.success).toBe(false);
    expect(verdict.message).toContain('has been modified externally');
  });
});

describeStrayNames(staleEditPatches);
