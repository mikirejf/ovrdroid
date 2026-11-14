import { describe, expect, test } from 'bun:test';
import { statSync } from 'node:fs';

import {
  fileTrackerPatches,
  TOOL_HOOKS_DONE_EVENT,
  TOOL_HOOKS_START_EVENT,
} from '../file-tracker-patches.ts';
import { holePattern } from '../tokens.ts';
import {
  busWithListeners,
  creditNoteOf,
  created,
  hooksRewriting,
  listenerPatch,
  noticePatch,
  outcomeOf,
  runOn,
  stamp,
  toolCall,
  trackedBy,
  useScratchFolder,
  writeResultWith,
} from './file-tracker-harness.ts';
import { describeStrayNames, failureOf } from './payload.ts';
import { stockDroid } from './stock-scanner.ts';

useScratchFolder();
describeStrayNames(fileTrackerPatches);

describe('tracker refresh after PostToolUse hooks', () => {
  test('the hook receives its context before the MCP identity', async () => {
    const tracker = trackedBy([]);
    const mcpIdentity = { serverName: 'fixture', toolName: 'write' };
    const calls: unknown[][] = [];

    await outcomeOf({
      tracker,
      id: 'call-mcp',
      name: 'fixture_write',
      mcpIdentity,
      hooks: async (...args) => {
        calls.push(args);
        await Bun.sleep(0);
        return [];
      },
    });

    expect(calls).toEqual([
      [
        'PostToolUse',
        expect.objectContaining({ tool_name: 'fixture_write', hook_event_name: 'PostToolUse' }),
        expect.objectContaining({ sessionId: 's', toolCallId: 'call-mcp', abortSignal: {} }),
        mcpIdentity,
      ],
    ]);
  });

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

    expect(results).toEqual({ kind: 'proceed', contexts: [], systemMessages: [], errors: [] });
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

  test.each([
    ['another event', 'hook_execution_started', 'PostToolUse', 'quiet-call', [{ exitCode: 0 }]],
    ['another hook', 'hook_execution_completed', 'PreToolUse', 'quiet-call', [{ exitCode: 0 }]],
    ['another call', 'hook_execution_completed', 'PostToolUse', 'other-call', [{ exitCode: 0 }]],
    ['no results', 'hook_execution_completed', 'PostToolUse', 'quiet-call', []],
  ] as const)(
    '%s does not count as this call running hooks',
    async (...[_label, type, hookEventName, hookToolCallId, hookResults]) => {
      const path = created('notification.ts');
      const tracker = trackedBy([[path, 'quiet-call', 'edit']]);
      const bus = busWithListeners(tracker);

      const { result } = await runOn(bus, {
        tracker,
        id: 'quiet-call',
        hooks: async () => {
          await Bun.sleep(0);
          stamp(path, 'changed\n', 20);
          bus.emit('project-notification', {
            notification: { type, hookEventName, hookToolCallId, hookResults },
          });
          return [];
        },
      });

      expect(result).toBe(writeResultWith(creditNoteOf('Execute', [path])));
      expect(bus.listenerCount('project-notification')).toBe(0);
    },
  );

  test('a hook failure removes the temporary completion listener', async () => {
    const tracker = trackedBy([]);
    const bus = busWithListeners(tracker);

    const failure = await failureOf(
      runOn(bus, {
        tracker,
        id: 'failed-hook',
        hooks: async () => {
          await Bun.sleep(0);
          throw new Error('hook stopped');
        },
      }),
    );

    expect(failure).toBe('hook stopped');
    expect(bus.listenerCount('project-notification')).toBe(0);
  });
});

describe.skipIf(stockDroid === undefined)('the stock hook notification contract', () => {
  test('completed hooks expose their event, tool call id and individual results', () => {
    const completed = new RegExp(
      holePattern(
        'de.emit("project-notification",{notification:{type:"hook_execution_completed",hookId:y,hookEventName:s,hookMatcher:g,...P,hookOrder:k,...U&&gM(s,U)&&{hookPreventedAction:!0},hookStatus:Z?"error":"completed",hookResults:j}})',
      ).source,
      'u',
    );
    const context = new RegExp(
      holePattern('P={hookToolCallId:a?.toolCallId,...o.message_id&&{hookParentId:o.message_id}};')
        .source,
      'u',
    );
    const modules = (stockDroid ?? []).filter((module) => completed.test(module.text));

    expect(modules).toHaveLength(1);
    expect(modules.some((module) => context.test(module.text))).toBe(true);
  });
});
