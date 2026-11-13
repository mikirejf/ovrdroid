import { readFileSync, writeFileSync } from 'node:fs';

import { say } from '../cli.ts';
import { FACTORY_TASK_INVOCATIONS } from '../paths.ts';
import { DROID_TYPE, launchHeldSubagent, withScenario } from './busy-signal.ts';
import type { Run, ScenarioOptions } from './busy-signal.ts';
import { LOG_PATH } from './effort-switch-turn.ts';
import { entriesOf, fieldsOfJson, numberAt, worded } from './fields.ts';
import type { Fields } from './fields.ts';
import {
  completedHelpers,
  historyPreviewVerdicts,
  hostLoggingSeen,
  reopenedHelpers,
} from './history-preview-report.ts';
import type { HistoryPreviewEvidence } from './history-preview-report.ts';
import { logSize, logSlice } from './log-file.ts';
import { LAUNCH_WORD } from './rewind-report.ts';
import { send, settle, waitFor } from './rewind.ts';
import { describeRoster, ROSTER_FILTER } from './roster-view-report.ts';

const ARROW_DOWN = '\u001B[B';
const ENTER = '\r';
const COMPLETED_TAG = 'finished';
const PREVIEW = /\bhi\b/u;
const REPLY = /⛬\s+ok/u;
const LOG_FLUSH_MS = 2000;

export const DEFAULT_HISTORY_PREVIEW_COUNT = 10;
export const DEFAULT_HISTORY_PREVIEW_TIMEOUT_S = 60;

export interface HistoryPreviewOptions extends ScenarioOptions {
  count: number;
  out: string | undefined;
}

function invocations(): Fields[] {
  return entriesOf(fieldsOfJson(readFileSync(FACTORY_TASK_INVOCATIONS, 'utf-8')), 'invocations');
}

async function launchCompleted(run: Run, index: number): Promise<string> {
  const before = new Set(invocations().map((entry) => worded(entry, 'childSessionId')));
  const tag = `${COMPLETED_TAG}${index}`;
  const description = `${DROID_TYPE} ${tag}`;
  await send(run.session, `${LAUNCH_WORD} ${tag}`);
  const launched = await waitFor(
    'the helper never started',
    () =>
      invocations().find(
        (entry) =>
          numberAt(entry, 'hostPid') === run.session.pid &&
          worded(entry, 'description') === description &&
          !before.has(worded(entry, 'childSessionId')),
      ),
    run.timeoutMs,
  );
  const parentSessionId = worded(launched, 'parentSessionId');
  const ids = await waitFor(
    'the helper never completed',
    () => {
      const completed = completedHelpers(invocations(), before, { parentSessionId, description });
      return completed.length > 0 ? completed : undefined;
    },
    run.timeoutMs,
  );
  await waitFor(
    'the main turn did not finish',
    () => (run.session.screen().some((line) => REPLY.test(line)) ? true : undefined),
    run.timeoutMs,
  );
  await settle(run.session);
  const [id] = ids;
  if (id === undefined) {
    throw new Error('a completed helper had no session id');
  }
  return id;
}

function showsPreview(run: Run): readonly string[] | undefined {
  const lines = run.session.screen();
  const filter = lines.findIndex((line) => line.includes(ROSTER_FILTER));
  const rows = lines.slice(filter + 1);
  return filter !== -1 &&
    rows.some((line) => line.includes(`${DROID_TYPE} ${COMPLETED_TAG}`)) &&
    rows.some((line) => PREVIEW.test(line))
    ? lines
    : undefined;
}

async function inspectPreviews(
  run: Run,
  helpers: readonly string[],
): Promise<{
  evidence: HistoryPreviewEvidence;
  screen: readonly string[];
}> {
  await launchHeldSubagent(run);
  const from = logSize(LOG_PATH);
  run.session.press(ARROW_DOWN);
  let screen: readonly string[];
  try {
    await waitFor(
      'the roster did not open',
      () => (run.session.screen().some((line) => line.includes(ROSTER_FILTER)) ? true : undefined),
      run.timeoutMs,
    );
    run.session.press(ARROW_DOWN);
    await settle(run.session);
    run.session.press(ENTER);
    screen = await waitFor(
      'the roster never showed a saved helper reply',
      () => showsPreview(run),
      run.timeoutMs,
    );
  } catch (error) {
    throw new Error(
      `${error instanceof Error ? error.message : String(error)}\n${run.session.screen().join('\n')}`,
      { cause: error },
    );
  }
  await run.session.quiet(LOG_FLUSH_MS, LOG_FLUSH_MS);
  await run.session.close();
  const log = await logSlice(LOG_PATH, from);
  return {
    evidence: {
      completed: helpers.length,
      previewShown: true,
      loggingSeen: false,
      reopened: reopenedHelpers(log, run.session.pid, helpers),
    },
    screen,
  };
}

export async function historyPreview(
  binary: string,
  options: HistoryPreviewOptions,
): Promise<void> {
  let evidence: HistoryPreviewEvidence | undefined;
  let screen: readonly string[] = [];
  const from = logSize(LOG_PATH);
  await withScenario(binary, { ...options, sharedProcessAgents: true }, async (run) => {
    const helpers: string[] = [];
    for (let index = 0; index < options.count; index++) {
      // oxlint-disable-next-line no-await-in-loop
      helpers.push(await launchCompleted(run, index));
    }
    const result = await inspectPreviews(run, helpers);
    evidence = {
      ...result.evidence,
      loggingSeen: hostLoggingSeen(await logSlice(LOG_PATH, from), run.session.pid),
    };
    screen = result.screen;
  });
  if (evidence === undefined) {
    throw new Error('the probe ended before the helper previews were checked');
  }
  const report = describeRoster(historyPreviewVerdicts(evidence));
  say(report);
  if (options.out !== undefined) {
    writeFileSync(options.out, `${report}\n\n${screen.join('\n')}\n`);
  }
  if (historyPreviewVerdicts(evidence).some((verdict) => !verdict.pass)) {
    process.exitCode = 1;
  }
}
