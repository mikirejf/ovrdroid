import { setTimeout as delay } from 'node:timers/promises';

import { MS_PER_SECOND } from '../cli.ts';
import { LOG_PATH } from './effort-switch-turn.ts';
import { fieldsOf, worded } from './fields.ts';
import { logSize } from './log-file.ts';
import { send, waitFor } from './rewind.ts';
import { projectDroidChurn } from './scope-leak-churn.ts';
import {
  createWaitProject,
  prepareWaitProject,
  saveWaitProject,
  removeWaitProject,
  hookRecords,
} from './scope-leak-project.ts';
import {
  LAUNCH_WORD,
  logEvents,
  QUICK_CHILDREN,
  RESPONSES_CHILD,
  FOLLOWUP_CHILD,
  WAIT_CHILDREN,
  waitLogReading,
} from './scope-leak-report.ts';
import type { ScopeLeakRun, WaitReportsEvidence } from './scope-leak-report.ts';
import { mixEvidence } from './scope-leak-tool-mix.ts';
import { startWaitStub } from './scope-leak-wait-stub.ts';
import type { ScopeLeakOptions } from './scope-leak.ts';
import { alive, watchUntil, logSince, LOG_FLUSH_MS } from './scope-leak.ts';
import { openSettledSession } from './session.ts';

const EXIT_POLL_MS = 250;

export async function runWaitReports(
  binary: string,
  options: ScopeLeakOptions,
): Promise<ScopeLeakRun> {
  const runDeadline = performance.now() + 130_000;
  const holdMs = Math.max(30, options.hold) * MS_PER_SECOND;
  const run = Date.now().toString(36);
  const project = createWaitProject(options, run);
  const { dir, toolsFile, droids, mixFile } = project;
  const churn = projectDroidChurn(options.churnDroids === true, droids, run);
  const responsesChild = options.responsesChild === true;
  const stub = startWaitStub(run, options.linger * MS_PER_SECOND, {
    beforeFirstReply: churn.beforeFirstReply,
    responsesChild,
    responsesFollowup: options.responsesFollowup === true,
    mixFile: options.toolMix === true ? mixFile : undefined,
  });
  let processLog = '';
  let result: ScopeLeakRun | undefined;
  let failure = '';
  let screen: readonly string[] = [];
  try {
    prepareWaitProject(project, stub.url, options);
    const start = logSize(LOG_PATH);
    const { session } = await openSettledSession(binary, {
      cwd: dir,
      env: {
        FACTORY_RUNTIME_SETTINGS_PATH: project.settingsFile,
        FACTORY_FEATURE_FLAGS_SNAPSHOT_PATH: project.flagsFile,
      },
      screen: true,
    });
    try {
      await send(session, `${LAUNCH_WORD} scope`);
      const timeout = options.timeout * MS_PER_SECOND;
      await waitFor(
        '14 blocking TaskOutput calls never started',
        () =>
          hookRecords(toolsFile).filter(
            (record) =>
              worded(record, 'hook_event_name') === 'PreToolUse' &&
              worded(record, 'tool_name') === 'TaskOutput',
          ).length === WAIT_CHILDREN
            ? true
            : undefined,
        Math.min(timeout, Math.max(1, runDeadline - performance.now() - holdMs)),
      );
      stub.release();
      const ids = stub.waits.map((call) => worded(fieldsOf(call.input), 'task_id'));
      const quick = ids.slice(0, QUICK_CHILDREN);
      const hooks = hookRecords(toolsFile);
      const main = worded(hooks[0] ?? new Map(), 'session_id');
      const deadline = Math.min(performance.now() + timeout, runDeadline - holdMs);
      let reading = waitLogReading('', session.pid, { main, children: quick });
      while (alive(session.pid) && performance.now() < deadline) {
        // oxlint-disable-next-line no-await-in-loop
        processLog = await logSince(start);
        reading = waitLogReading(processLog, session.pid, { main, children: quick });
        churn.advance(reading.tornDown);
        if (
          reading.tornDown === QUICK_CHILDREN &&
          stub.phases.filter((phase) => phase.phase === 'quick-replied').length === QUICK_CHILDREN
        ) {
          break;
        }
        // oxlint-disable-next-line no-await-in-loop
        await delay(EXIT_POLL_MS);
      }
      if (alive(session.pid) && reading.tornDown !== QUICK_CHILDREN) {
        throw new Error('11 quick children did not tear down within the bounded run');
      }
      const exited = await watchUntil(session.pid, holdMs);
      await delay(LOG_FLUSH_MS);
      processLog = await logSince(start);
      reading = waitLogReading(processLog, session.pid, { main, children: quick });
      const records = hookRecords(toolsFile);
      const starts = records.filter((record) => worded(record, 'hook_event_name') === 'PreToolUse');
      const waitsStarted = starts.filter((record) => worded(record, 'tool_name') === 'TaskOutput');
      const waitReports: WaitReportsEvidence = {
        launched: ids.length,
        waitsStarted: new Set(
          waitsStarted.map((record) => worded(fieldsOf(record.get('tool_input')), 'task_id')),
        ).size,
        waitsFinished: records.filter(
          (record) => worded(record, 'hook_event_name') === 'PostToolUse',
        ).length,
        completed: new Set(
          records
            .filter(
              (record) =>
                worded(record, 'hook_event_name') === 'PostToolUse' &&
                worded(record, 'tool_response').includes('Status: completed'),
            )
            .map((record) => worded(fieldsOf(record.get('tool_input')), 'task_id')),
        ).size,
        tornDown: reading.tornDown,
        heldPending: stub.held.size,
        quickReplies: new Set(
          stub.phases
            .filter((phase) => phase.phase === 'quick-replied')
            .map((phase) => phase.child),
        ).size,
        closedHosts: reading.closedHosts,
        mainState: reading.mainState,
        observedAfterTeardownMs:
          reading.lastTeardownMs === 0 ? 0 : Date.now() - reading.lastTeardownMs,
      };
      const responseEvidence = (child: number) => {
        const responsesId = ids[child] ?? '';
        const streams = stub.streams.filter((stream) => stream.child === child);
        return {
          sessionId: responsesId,
          requests: streams.length,
          completed: records.some(
            (record) =>
              worded(record, 'hook_event_name') === 'PostToolUse' &&
              worded(fieldsOf(record.get('tool_input')), 'task_id') === responsesId &&
              worded(record, 'tool_response').includes('Status: completed'),
          ),
          closed: reading.closedChildren.includes(responsesId),
          tornDown: reading.teardowns[responsesId] !== undefined,
          lastTeardown: reading.lastTornDownChild === responsesId,
          teardownMs: reading.teardowns[responsesId] ?? 0,
          closedMs: reading.hostCloses[responsesId] ?? 0,
          streams,
        };
      };
      if (responsesChild) {
        waitReports.responsesChild = responseEvidence(RESPONSES_CHILD);
      }
      if (options.responsesFollowup === true) {
        waitReports.responsesFollowup = responseEvidence(FOLLOWUP_CHILD);
      }
      if (options.toolMix === true) {
        waitReports.toolMix = mixEvidence(stub.work, stub.bodies);
      }
      result = {
        binary,
        exited,
        events: logEvents(processLog, session.pid),
        ...churn.evidence(processLog, session.pid, main),
        waitReports,
      };
    } finally {
      screen = session.screen();
      processLog = await logSince(start);
      await session.close();
    }
    return result;
  } catch (error) {
    failure = error instanceof Error ? (error.stack ?? error.message) : String(error);
    throw error;
  } finally {
    saveWaitProject(project, {
      bodies: stub.bodies,
      phases: stub.phases,
      processLog,
      screen,
      evidence: {
        run,
        result,
        failure,
        mutations: churn.mutations,
        toolMix: options.toolMix === true ? mixEvidence(stub.work, stub.bodies) : undefined,
      },
    });
    await stub.stop();
    removeWaitProject(dir);
  }
}
