import { afterAll, beforeAll } from 'bun:test';
import { EventEmitter } from 'node:events';
import { existsSync, mkdtempSync, rmSync, statSync, utimesSync, writeFileSync } from 'node:fs';
import fsPromises from 'node:fs/promises';
import { tmpdir } from 'node:os';
import nodePath from 'node:path';

import { HOOK_DIFF_NOTE, hookFormatPatches } from '../hook-format-patches.ts';
import { patchNamed, payloadFunction } from './payload.ts';

interface Entry {
  mtime: Date;
  toolCallId: string;
  operation: string;
}

export class FakeTracker {
  fileTimestamps = new Map<string, Entry>();
  delayMs = 0;

  track(path: string, toolCallId: string, operation: string): void {
    this.fileTimestamps.set(path, { mtime: statSync(path).mtime, toolCallId, operation });
  }

  async trackFileOperation(path: string, toolCallId: string, operation: string): Promise<void> {
    await Bun.sleep(this.delayMs);
    if (existsSync(path)) {
      this.track(path, toolCallId, operation);
    }
  }

  hasFileChangedExternally(path: string): boolean {
    const entry = this.fileTimestamps.get(path);
    return entry !== undefined && statSync(path).mtime.getTime() !== entry.mtime.getTime();
  }
}

export type Hooks = (event: string) => Promise<object[]>;

export interface ToolOutcome {
  results: object[];
  result: string;
}

interface ToolCall {
  tracker: FakeTracker;
  id: string;
  hooks: Hooks;
  result?: string;
}

export const listenerPatch = patchNamed(hookFormatPatches, 'tracker-refresh-after-tool-hooks');
export const noticePatch = patchNamed(hookFormatPatches, 'tool-hooks-done-notice');

const install = payloadFunction<[() => FakeTracker, EventEmitter, typeof fsPromises], undefined>(
  ['gc', 'process', 'de'],
  listenerPatch.replace.slice(listenerPatch.find.length),
);

const afterTool = payloadFunction<
  [Hooks, EventEmitter, { id: string }, string],
  Promise<ToolOutcome>
>(
  ['_o', 'process', 'd', 'result'],
  'const I=()=>"/",JR=()=>"default",q="s",C="",w=0,o={abortController:{signal:{}}};' +
    'return(async function(){let z=result;' +
    `let x=0,${noticePatch.replace};return{results:ie,result:z}}).call({context:{},updateAction:undefined})`,
);

export const noteOf = payloadFunction<[], (path: string, before: string, after: string) => string>(
  [],
  `${HOOK_DIFF_NOTE}return $ODnote`,
)();

export const WRITE_RESULT = JSON.stringify({ success: true, message: 'Created', wasNewFile: true });

export function writeResultWith(systemReminder: string): string {
  return JSON.stringify({ success: true, message: 'Created', wasNewFile: true, systemReminder });
}

const BASE_MS = Date.parse('2026-01-01T00:00:00Z');
const SECOND_MS = 1000;

let folder = '';

export function useScratchFolder(): void {
  beforeAll(() => {
    folder = mkdtempSync(nodePath.join(tmpdir(), 'hook-format-'));
  });

  afterAll(() => {
    rmSync(folder, { recursive: true, force: true });
  });
}

export function pathOf(name: string): string {
  return nodePath.join(folder, name);
}

export function stamp(path: string, text: string, secondsAfterBase: number): string {
  writeFileSync(path, text);
  const at = new Date(BASE_MS + secondsAfterBase * SECOND_MS);
  utimesSync(path, at, at);
  return path;
}

export function created(name: string): string {
  return stamp(pathOf(name), name, 10);
}

export function trackedBy(entries: readonly [string, string, string][]): FakeTracker {
  const tracker = new FakeTracker();
  for (const [path, toolCallId, operation] of entries) {
    tracker.track(path, toolCallId, operation);
  }
  return tracker;
}

export function writtenWith(name: string, text: string, id: string): FakeTracker {
  return trackedBy([[stamp(pathOf(name), text, 10), id, 'create']]);
}

export function hooksWriting(files: Readonly<Record<string, string>>, results: object[]): Hooks {
  return async () => {
    await Bun.sleep(0);
    for (const [file, text] of Object.entries(files)) {
      stamp(file, text, 20);
    }
    return results;
  };
}

export function hooksRewriting(files: readonly string[], results: object[]): Hooks {
  return hooksWriting(
    Object.fromEntries(files.map((file) => [file, `${file} rewritten`])),
    results,
  );
}

export function busWithListeners(tracker: FakeTracker): EventEmitter {
  // oxlint-disable-next-line unicorn/prefer-event-target
  const bus = new EventEmitter();
  install(() => tracker, bus, fsPromises);
  return bus;
}

export async function runOn(bus: EventEmitter, call: ToolCall): Promise<ToolOutcome> {
  return await afterTool(call.hooks, bus, { id: call.id }, call.result ?? WRITE_RESULT);
}

export async function outcomeOf(call: ToolCall): Promise<ToolOutcome> {
  return await runOn(busWithListeners(call.tracker), call);
}

export async function toolCall(tracker: FakeTracker, id: string, hooks: Hooks): Promise<object[]> {
  const outcome = await outcomeOf({ tracker, id, hooks });
  return outcome.results;
}
