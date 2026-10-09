import { describe, expect, test } from 'bun:test';
import { statSync } from 'node:fs';

import { TOOL_HOOKS_DONE_EVENT, TOOL_HOOKS_START_EVENT } from '../file-tracker-patches.ts';
import {
  created,
  hooksRewriting,
  listenerPatch,
  noticePatch,
  toolCall,
  trackedBy,
  useScratchFolder,
} from './file-tracker-harness.ts';

useScratchFolder();

describe('tracker refresh after PostToolUse hooks', () => {
  test('a hook that rewrote the file this call wrote counts as the call own change', async () => {
    const path = created('written.ts');
    const tracker = trackedBy([[path, 'call-1', 'edit']]);

    await toolCall(tracker, 'call-1', hooksRewriting([path], [{ exitCode: 0 }]));

    expect(tracker.fileTimestamps.get(path)?.mtime.getTime()).toBe(statSync(path).mtime.getTime());
    expect(tracker.hasFileChangedExternally(path)).toBe(false);
  });

  test('the call waits until the refresh is done', async () => {
    const path = created('slow.ts');
    const tracker = trackedBy([[path, 'call-2', 'create']]);
    tracker.delayMs = 30;

    await toolCall(tracker, 'call-2', hooksRewriting([path], [{ exitCode: 0 }]));

    expect(tracker.hasFileChangedExternally(path)).toBe(false);
  });

  test('no hook ran, so the credit step is what records the change', async () => {
    const path = created('quiet.ts');
    const tracker = trackedBy([[path, 'call-3', 'create']]);

    const results = await toolCall(tracker, 'call-3', hooksRewriting([path], []));

    expect(results).toEqual([]);
    expect(tracker.hasFileChangedExternally(path)).toBe(false);
  });

  test('files of another call and files only read are credited, not refreshed as hook output', async () => {
    const mine = created('mine.ts');
    const theirs = created('theirs.ts');
    const seen = created('seen.ts');
    const tracker = trackedBy([
      [mine, 'call-4', 'edit'],
      [theirs, 'call-other', 'edit'],
      [seen, 'call-4', 'read'],
    ]);

    await toolCall(tracker, 'call-4', hooksRewriting([mine, theirs, seen], [{ exitCode: 0 }]));

    expect(tracker.hasFileChangedExternally(mine)).toBe(false);
    expect(tracker.hasFileChangedExternally(theirs)).toBe(false);
    expect(tracker.hasFileChangedExternally(seen)).toBe(false);
    expect(tracker.fileTimestamps.get(seen)?.operation).toBe('read');
  });

  test('the notice and the listener use the same event names', () => {
    for (const event of [TOOL_HOOKS_START_EVENT, TOOL_HOOKS_DONE_EVENT]) {
      expect(noticePatch.replace).toContain(JSON.stringify(event));
      expect(listenerPatch.replace).toContain(JSON.stringify(event));
    }
  });
});
