import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { EventEmitter } from 'node:events';
import { mkdtempSync, rmSync, statSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import nodePath from 'node:path';

import { hookFormatPatches, TOOL_HOOKS_DONE_EVENT } from '../hook-format-patches.ts';
import { patchNamed, payloadFunction } from './payload.ts';

interface Entry {
  mtime: Date;
  toolCallId: string;
  operation: string;
}

class FakeTracker {
  fileTimestamps = new Map<string, Entry>();
  delayMs = 0;

  track(path: string, toolCallId: string, operation: string): void {
    this.fileTimestamps.set(path, { mtime: statSync(path).mtime, toolCallId, operation });
  }

  async trackFileOperation(path: string, toolCallId: string, operation: string): Promise<void> {
    await Bun.sleep(this.delayMs);
    this.track(path, toolCallId, operation);
  }

  hasFileChangedExternally(path: string): boolean {
    const entry = this.fileTimestamps.get(path);
    return entry !== undefined && statSync(path).mtime.getTime() !== entry.mtime.getTime();
  }
}

type Hooks = (event: string) => Promise<object[]>;

const listenerPatch = patchNamed(hookFormatPatches, 'tracker-refresh-after-tool-hooks');
const noticePatch = patchNamed(hookFormatPatches, 'tool-hooks-done-notice');

const install = payloadFunction<[() => FakeTracker, EventEmitter], undefined>(
  ['gc', 'process'],
  listenerPatch.replace.slice(listenerPatch.find.length),
);

const afterTool = payloadFunction<[Hooks, EventEmitter, { id: string }], Promise<object[]>>(
  ['_o', 'process', 'd'],
  'const I=()=>"/",JR=()=>"default",q="s",C="",w=0,z={},o={abortController:{signal:{}}};' +
    `return(async function(){let ie;${noticePatch.replace};return ie}).call({context:{},updateAction:undefined})`,
);

const BASE_MS = Date.parse('2026-01-01T00:00:00Z');
const SECOND_MS = 1000;

let folder = '';

function stamp(path: string, text: string, secondsAfterBase: number): string {
  writeFileSync(path, text);
  const at = new Date(BASE_MS + secondsAfterBase * SECOND_MS);
  utimesSync(path, at, at);
  return path;
}

function created(name: string): string {
  return stamp(nodePath.join(folder, name), name, 10);
}

function trackedBy(entries: readonly [string, string, string][]): FakeTracker {
  const tracker = new FakeTracker();
  for (const [path, toolCallId, operation] of entries) {
    tracker.track(path, toolCallId, operation);
  }
  return tracker;
}

function hooksRewriting(files: readonly string[], results: object[]): Hooks {
  return async () => {
    await Bun.sleep(0);
    for (const file of files) {
      stamp(file, `${file} rewritten`, 20);
    }
    return results;
  };
}

async function toolCall(tracker: FakeTracker, id: string, hooks: Hooks): Promise<object[]> {
  // oxlint-disable-next-line unicorn/prefer-event-target
  const bus = new EventEmitter();
  install(() => tracker, bus);
  return await afterTool(hooks, bus, { id });
}

beforeAll(() => {
  folder = mkdtempSync(nodePath.join(tmpdir(), 'hook-format-'));
});

afterAll(() => {
  rmSync(folder, { recursive: true, force: true });
});

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

  test('no hook ran, so the tracker is left alone', async () => {
    const path = created('quiet.ts');
    const tracker = trackedBy([[path, 'call-3', 'create']]);

    const results = await toolCall(tracker, 'call-3', hooksRewriting([path], []));

    expect(results).toEqual([]);
    expect(tracker.hasFileChangedExternally(path)).toBe(true);
  });

  test('files of another call and files only read stay stale', async () => {
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
    expect(tracker.hasFileChangedExternally(theirs)).toBe(true);
    expect(tracker.hasFileChangedExternally(seen)).toBe(true);
  });

  test('the notice and the listener use the same event name', () => {
    expect(noticePatch.replace).toContain(JSON.stringify(TOOL_HOOKS_DONE_EVENT));
    expect(listenerPatch.replace).toContain(JSON.stringify(TOOL_HOOKS_DONE_EVENT));
  });
});
