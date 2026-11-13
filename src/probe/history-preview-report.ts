import { fieldsOfJson, numberAt, worded } from './fields.ts';
import type { Fields } from './fields.ts';
import type { Verdict } from './roster-view-report.ts';

const CONTEXT = ' | Context: ';
const LOAD_SESSION = '[Daemon] JSON-RPC handling load_session';
const HOST_STARTED = '[Daemon] Hosting Droid agent in process';

export interface HistoryPreviewEvidence {
  completed: number;
  previewShown: boolean;
  loggingSeen: boolean;
  reopened: readonly string[];
}

export function completedHelpers(
  records: readonly Fields[],
  before: ReadonlySet<string>,
  task: { parentSessionId: string; description: string },
): string[] {
  return records
    .filter(
      (record) =>
        worded(record, 'parentSessionId') === task.parentSessionId &&
        worded(record, 'description') === task.description &&
        worded(record, 'status') === 'completed' &&
        !before.has(worded(record, 'childSessionId')),
    )
    .map((record) => worded(record, 'childSessionId'));
}

export function reopenedHelpers(log: string, pid: number, helpers: readonly string[]): string[] {
  const ids = new Set(helpers);
  const reopened = new Set<string>();
  for (const line of log.split('\n')) {
    if (!line.includes(LOAD_SESSION)) {
      continue;
    }
    const boundary = line.indexOf(CONTEXT);
    if (boundary === -1) {
      continue;
    }
    const context = fieldsOfJson(line.slice(boundary + CONTEXT.length));
    const id = worded(context, 'sessionId');
    if (numberAt(context, 'process.pid') === pid && ids.has(id)) {
      reopened.add(id);
    }
  }
  return [...reopened];
}

export function hostLoggingSeen(log: string, pid: number): boolean {
  return log.split('\n').some((line) => {
    if (!line.includes(HOST_STARTED)) {
      return false;
    }
    const boundary = line.indexOf(CONTEXT);
    return (
      boundary !== -1 &&
      numberAt(fieldsOfJson(line.slice(boundary + CONTEXT.length)), 'process.pid') === pid
    );
  });
}

export function historyPreviewVerdicts(evidence: HistoryPreviewEvidence): Verdict[] {
  return [
    {
      pass: evidence.completed > 0 && evidence.previewShown,
      text: evidence.previewShown
        ? `the roster read a saved reply after ${evidence.completed} helpers finished`
        : 'no saved helper reply appeared in the roster, so the bug was not exercised',
    },
    {
      pass: evidence.loggingSeen,
      text: evidence.loggingSeen
        ? 'the log captured agent hosting in the tested Droid process'
        : 'agent hosting was not captured, so runtime reopening cannot be checked',
    },
    {
      pass: evidence.reopened.length === 0,
      text:
        evidence.reopened.length === 0
          ? 'reading finished helper previews reopened no agent runtimes'
          : `reading finished helper previews reopened ${evidence.reopened.length} agent runtime(s)`,
    },
  ];
}
