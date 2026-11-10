import { describe, expect, test } from 'bun:test';

import {
  groupScopeRows,
  liveChildren,
  liveDone,
  livePidLog,
  liveVerdict,
  LIVE_MODEL,
  LIVE_PROMPT,
} from '../scope-leak-live.ts';
import type { LiveEvidence } from '../scope-leak-live.ts';

const PID = 123;
const STAMP = '2026-11-10T16:00:00.000Z';
const AT_MS = Date.parse(STAMP);
const APP_FRAMES = [
  '    at first (/$bunfs/root/entry-a.js:1:2)',
  '    at second (/$bunfs/root/entry-b.js:3:4)',
  '    at third (/$bunfs/root/entry-c.js:5:6)',
];
interface ScopeOverrides {
  pid?: number;
  stack?: string | undefined;
}
type LogContext = Record<string, string | boolean | { sessionId: string; modelId?: string }>;
function scopeRow(event: string, extra: ScopeOverrides = {}): string {
  return JSON.stringify({
    t: STAMP,
    pid: PID,
    event,
    scope: { sessionId: 'child-0', disposing: true, disposed: false },
    stack: ['    at internal (node:timers:1:2)', ...APP_FRAMES].join('\n'),
    ...extra,
  });
}
function logLine(message: string, context: LogContext, pid = PID): string {
  return `[${STAMP}] INFO: ${message} | Context: ${JSON.stringify({ ...context, 'process.pid': pid })}\n`;
}
function covered(): LiveEvidence {
  return {
    pid: PID,
    launchedAtMs: AT_MS - 1000,
    liveDoneAtMs: AT_MS,
    observedMs: 30_000,
    quitAtMs: AT_MS + 30_000,
    exited: false,
    autonomy: 'low',
    failure: '',
    fatal: '',
    main: 'main',
    children: Array.from({ length: 4 }, (_, index) => ({
      sessionId: `child-${index}`,
      model: LIVE_MODEL,
      effort: index < 2 ? 'low' : 'medium',
      completed: true,
      teardownMs: AT_MS - 1,
      hostCloseMs: AT_MS,
    })),
    diagnostics: groupScopeRows(scopeRow('init'), PID),
  };
}

describe('live scope diagnostics', () => {
  test('groups only UI events by event and top three app frames, retaining a full original example', () => {
    const first = scopeRow('schedule');
    const second = scopeRow('schedule', {
      stack: [...APP_FRAMES, '    at extra (/$bunfs/root/entry-d.js:1:1)'].join('\n'),
    });
    const summary = groupScopeRows(
      [
        scopeRow('init'),
        first,
        second,
        scopeRow('fire'),
        scopeRow('footer-render'),
        scopeRow('inactive-read'),
        scopeRow('schedule', { pid: 456 }),
      ].join('\n'),
      PID,
    );
    expect(summary.counts).toEqual({
      init: 1,
      schedule: 2,
      fire: 1,
      'footer-render': 1,
      'inactive-read': 1,
    });
    expect(summary.scopedUiRows).toBe(4);
    expect(summary.groups).toHaveLength(3);
    expect(summary.groups[0]).toEqual({
      event: 'schedule',
      frames: APP_FRAMES,
      count: 2,
      example: first,
    });
    expect(summary.invalidRows).toBe(0);
    expect(groupScopeRows(`${first}\nnot JSON\n`, PID).invalidRows).toBe(1);
    expect(
      groupScopeRows(scopeRow('schedule', { stack: APP_FRAMES[0] }), PID).groups[0]?.frames,
    ).toHaveLength(1);
  });
  test('a changed top app frame forms a distinct group', () => {
    const summary = groupScopeRows(
      [
        scopeRow('schedule'),
        scopeRow('schedule', { stack: 'at other (/$bunfs/root/entry-other.js:1:1)' }),
      ].join('\n'),
      PID,
    );
    expect(summary.groups.map((group) => group.count)).toEqual([1, 1]);
  });
});
describe('live process evidence', () => {
  test('filters whole entries to one pid, preserving multiline fatal stacks', () => {
    const fatal = logLine('CLI startup failed\nAgent runtime scope is disposed\n    at footer', {
      sessionId: 'main',
    });
    const log = logLine('other', {}, 456) + fatal;
    expect(livePidLog(log, PID)).toBe(fatal);
    expect(livePidLog(log, 12)).toBe('');
  });
  test('reads actual model/effort, successful completions, teardowns and host closures', () => {
    const childLog = Array.from({ length: 4 }, (_, index) =>
      [
        logLine('[LLM] sendMessage', {
          tags: { sessionId: `child-${index}`, modelId: LIVE_MODEL },
          reasoningEffort: index < 2 ? 'low' : 'medium',
        }),
        logLine('notify', { messageId: `task-completion:unrelated-notification-${index}` }),
        logLine('[Daemon] Agent run complete', { sessionId: `child-${index}`, isError: false }),
        logLine('[Tool] Task tool manager shutting down', {
          tags: { sessionId: `child-${index}` },
        }),
        logLine('[metrics_log_daemon_agent_host_close_count]', {
          type: 'in_process',
          outcome: 'success',
          sessionId: 'main',
        }),
      ].join(''),
    ).join('');
    const log =
      logLine('foreign', { sessionId: 'not-main' }, 456) +
      logLine('start', { sessionId: 'main' }) +
      childLog;
    expect(liveChildren(log, PID)).toEqual({
      main: 'main',
      children: covered().children.map((child) => Object.assign(child, { teardownMs: AT_MS })),
    });
    const noCompletion =
      logLine('start', { sessionId: 'main' }) +
      logLine('[LLM] sendMessage', {
        sessionId: 'child-0',
        modelId: LIVE_MODEL,
        reasoningEffort: 'low',
      }) +
      logLine('notify', { messageId: 'task-completion:child-0:turn' }) +
      logLine('[Daemon] Agent run complete', { sessionId: 'child-0', isError: true }) +
      logLine('[Daemon] Agent run complete', { sessionId: 'child-0', isError: false }, 456);
    expect(liveChildren(noCompletion, PID).children[0]?.completed).toBe(false);
  });
  test('recognizes the assistant reply, not the literal LIVE-DONE in the prompt', () => {
    expect(liveDone([LIVE_PROMPT])).toBe(false);
    expect(liveDone(['  ⛬  LIVE-DONE', '  > '])).toBe(true);
    expect(liveDone(['⛬ LIVE-DONE and more'])).toBe(false);
    expect(liveDone(['LIVE-DONE'])).toBe(false);
  });
});
describe('live verdict', () => {
  test('reports covered survival with and without scoped UI rows', () => {
    expect(liveVerdict(covered())).toBe('survived, no scoped UI work');
    const evidence = covered();
    evidence.diagnostics = groupScopeRows(
      [scopeRow('init'), scopeRow('schedule'), scopeRow('fire')].join('\n'),
      PID,
    );
    expect(liveVerdict(evidence)).toBe('survived, 2 scoped UI rows');
  });
  test('early exit is a crash even with missing coverage and includes fatal text', () => {
    const evidence = covered();
    evidence.exited = true;
    evidence.children = [];
    evidence.fatal = 'Startup failed: Agent runtime scope is disposed';
    expect(liveVerdict(evidence)).toBe('crashed: Startup failed: Agent runtime scope is disposed');
    evidence.fatal = '';
    expect(liveVerdict(evidence)).toContain('process exited early without logged fatal text');
  });
  test('names each missing coverage item instead of calling an idle process survived', () => {
    for (const modify of [
      (e: LiveEvidence) => {
        e.children.pop();
      },
      (e: LiveEvidence) => {
        for (const child of e.children) {
          child.completed = false;
        }
      },
      (e: LiveEvidence) => {
        for (const child of e.children) {
          child.hostCloseMs = 0;
        }
      },
      (e: LiveEvidence) => {
        for (const child of e.children) {
          child.model = 'other';
        }
      },
      (e: LiveEvidence) => {
        for (const child of e.children) {
          child.effort = 'high';
        }
      },
      (e: LiveEvidence) => {
        e.liveDoneAtMs = 0;
      },
      (e: LiveEvidence) => {
        e.observedMs = 29_999;
      },
      (e: LiveEvidence) => {
        e.failure = 'confirmation stayed blocked';
      },
      (e: LiveEvidence) => {
        e.diagnostics = groupScopeRows('', PID);
      },
    ]) {
      const evidence = covered();
      modify(evidence);
      expect(liveVerdict(evidence)).toStartWith('unproven:');
    }
  });
});
