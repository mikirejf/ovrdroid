import type { Fields } from './fields.ts';
import { entriesOf, fieldsOf, fieldsOfJson, worded } from './fields.ts';
import { LAUNCH_WORD, answerFor } from './rewind-report.ts';
import { waitReportsExercised } from './scope-leak-coverage.ts';
import type { WaitReportsEvidence } from './scope-leak-coverage.ts';
import { flagCoverage, flagOutcome } from './scope-leak-flags.ts';
import type { FlagEvidence } from './scope-leak-flags.ts';
import { describeMix } from './scope-leak-tool-mix.ts';

export { HOLD_WORD, LAUNCH_WORD } from './rewind-report.ts';
export const NOTICE_START = 'Background task';
export const SCOPE_DISPOSED = 'Agent runtime scope is disposed';
export * from './scope-leak-coverage.ts';
const ENTRY_START = /^\[(?<stamp>\d{4}-\d\d-\d\dT[\d:.]+Z)\] [A-Z]+: /u;
const STARTUP_FAILED = 'CLI startup failed';
const MANAGER_SHUTDOWN = 'Task tool manager shutting down';
const COMPLETION = 'messageId":"task-completion:';
const LATE_CALLBACK = 'Background process exit callback failed';
export type StubTurn = 'launch' | 'child-work' | 'child' | 'notice' | 'text';
function textOf(message: Fields): string {
  const content = message.get('content');
  if (typeof content === 'string') {
    return content;
  }
  return entriesOf(message, 'content')
    .filter((block) => worded(block, 'type') === 'text')
    .map((block) => worded(block, 'text'))
    .join('\n');
}
function lastUserMessage(body: unknown): Fields | undefined {
  const last = entriesOf(fieldsOf(body), 'messages').at(-1);
  return last !== undefined && worded(last, 'role') === 'user' ? last : undefined;
}
function answersTool(message: Fields | undefined): boolean {
  return (
    message !== undefined &&
    entriesOf(message, 'content').some((block) => worded(block, 'type') === 'tool_result')
  );
}
export function turnFor(body: unknown): StubTurn {
  const answer = answerFor(body);
  const last = lastUserMessage(body);
  if (answer.kind === 'child') {
    return answersTool(last) ? 'child' : 'child-work';
  }
  if (answer.kind === 'launch') {
    return 'launch';
  }
  return last !== undefined && !answersTool(last) && textOf(last).includes(NOTICE_START)
    ? 'notice'
    : 'text';
}
export type MainTurn = 'launch' | 'notice' | 'text';
export function mainTurnFor(body: unknown): MainTurn {
  const last = entriesOf(fieldsOf(body), 'messages').at(-1);
  if (last === undefined || worded(last, 'role') !== 'user') {
    return 'text';
  }
  const text = textOf(last);
  if (text.includes(NOTICE_START)) {
    return 'notice';
  }
  return text.includes(`${LAUNCH_WORD} `) ? 'launch' : 'text';
}
export type LogEventKind = 'completion' | 'shutdown' | 'crash' | 'late-callback';
export interface LogEvent {
  atMs: number;
  kind: LogEventKind;
}
function kindOf(entry: string): LogEventKind | undefined {
  const head = entry.split('\n', 1)[0] ?? '';
  if (head.includes(STARTUP_FAILED) && entry.includes(SCOPE_DISPOSED)) {
    return 'crash';
  }
  if (head.includes(LATE_CALLBACK) && entry.includes(SCOPE_DISPOSED)) {
    return 'late-callback';
  }
  if (head.includes(MANAGER_SHUTDOWN)) {
    return 'shutdown';
  }
  return head.includes(COMPLETION) ? 'completion' : undefined;
}
function entriesIn(log: string): string[] {
  const entries: string[] = [];
  for (const line of log.split('\n')) {
    if (ENTRY_START.test(line) || entries.length === 0) {
      entries.push(line);
    } else {
      entries[entries.length - 1] += `\n${line}`;
    }
  }
  return entries;
}
function logTime(entry: string): number {
  return Date.parse(ENTRY_START.exec(entry)?.groups?.['stamp'] ?? '');
}
export function waitLogReading(
  log: string,
  pid: number,
  { main, children }: { main: string; children: readonly string[] },
) {
  const shutdowns = new Map<string, number>();
  const completions = new Set<string>();
  let mainState = '';
  let closedHosts = 0;
  const pendingCloses = new Set<string>();
  const closedChildren = new Map<string, number>();
  for (const entry of entriesIn(log)) {
    if (!entry.includes(`"process.pid":${pid}}`)) {
      continue;
    }
    const context = fieldsOfJson(entry.split(' | Context: ')[1] ?? '');
    const session =
      worded(context, 'sessionId') || worded(fieldsOf(context.get('tags')), 'sessionId');
    if (children.includes(session) && entry.includes(MANAGER_SHUTDOWN)) {
      shutdowns.set(session, logTime(entry));
      pendingCloses.add(session);
    }
    if (
      entry.includes('[metrics_log_daemon_agent_host_close_count]') &&
      worded(context, 'type') === 'in_process' &&
      worded(context, 'outcome') === 'success'
    ) {
      closedHosts += 1;
      if (pendingCloses.size === 1) {
        for (const child of pendingCloses) {
          closedChildren.set(child, logTime(entry));
        }
      }
      pendingCloses.clear();
    }
    for (const child of children) {
      if (entry.includes(`${COMPLETION}${child}`)) {
        completions.add(child);
      }
    }
    if (session === main && entry.includes('[Daemon] Droid working state changed')) {
      mainState = worded(context, 'value');
    }
  }
  return {
    tornDown: shutdowns.size,
    completed: completions.size,
    lastTeardownMs: Math.max(0, ...shutdowns.values()),
    mainState,
    closedHosts,
    closedChildren: [...closedChildren.keys()],
    teardowns: Object.fromEntries(shutdowns),
    hostCloses: Object.fromEntries(closedChildren),
    lastTornDownChild: [...shutdowns.keys()].at(-1) ?? '',
  };
}
export function logEvents(log: string, pid: number): LogEvent[] {
  const owner = `"process.pid":${pid}}`;
  return entriesIn(log).flatMap((entry) => {
    const stamp = ENTRY_START.exec(entry)?.groups?.['stamp'];
    const kind = kindOf(entry);
    if (stamp === undefined || kind === undefined || !entry.includes(owner)) {
      return [];
    }
    return [{ atMs: Date.parse(stamp), kind }];
  });
}
export interface ScopeLeakRun {
  flagRefresh?: FlagEvidence;
  binary: string;
  exited: boolean;
  events: readonly LogEvent[];
  waitReports?: WaitReportsEvidence;
  churnDroids?: DroidChurnEvidence;
}
export interface DroidMutation {
  atMs: number;
  phase: 'before-first-reply' | 'after-first-teardown' | 'after-last-teardown';
  action: 'add' | 'remove';
}
interface DroidWatchEvent {
  atMs: number;
  kind: 'file-change' | 'registration';
  sessionId: string;
}
export interface DroidChurnEvidence {
  main: string;
  file: string;
  mutations: DroidMutation[];
  events: DroidWatchEvent[];
}
export function droidChurnEvents(log: string, pid: number, file: string): DroidWatchEvent[] {
  return entriesIn(log).flatMap<DroidWatchEvent>((entry) => {
    const stamp = ENTRY_START.exec(entry)?.groups?.['stamp'];
    if (stamp === undefined || !entry.includes(`"process.pid":${pid}}`)) {
      return [];
    }
    const context = fieldsOfJson(entry.split(' | Context: ')[1] ?? '');
    const sessionId =
      worded(context, 'sessionId') || worded(fieldsOf(context.get('tags')), 'sessionId');
    if (
      entry.includes('[Tool] Droid file change detected') &&
      worded(context, 'location') === 'project' &&
      worded(context, 'name') === file
    ) {
      return [{ atMs: Date.parse(stamp), kind: 'file-change' as const, sessionId }];
    }
    return entry.includes('[Tool] Task tool registration applied') &&
      worded(context, 'state') === 'updated'
      ? [{ atMs: Date.parse(stamp), kind: 'registration' as const, sessionId }]
      : [];
  });
}
export function droidChurnExercised(evidence: DroidChurnEvidence): boolean {
  return (
    evidence.mutations.map((mutation) => mutation.phase).join(',') ===
      'before-first-reply,after-first-teardown,after-last-teardown' &&
    evidence.mutations.every((mutation, index) => {
      const until = evidence.mutations[index + 1]?.atMs ?? Infinity;
      const events = evidence.events.filter(
        (event) =>
          event.sessionId === evidence.main && event.atMs >= mutation.atMs && event.atMs < until,
      );
      const change = events.find((event) => event.kind === 'file-change');
      return (
        change !== undefined &&
        events.some((event) => event.kind === 'registration' && event.atMs >= change.atMs)
      );
    })
  );
}
export type Outcome = 'crashed' | 'survived' | 'unproven';
export function outcomeOf(run: ScopeLeakRun): Outcome {
  if (run.flagRefresh !== undefined) {
    return flagOutcome(run.flagRefresh);
  }
  if (run.events.some((event) => event.kind === 'crash')) {
    return 'crashed';
  }
  const exercised =
    run.waitReports === undefined
      ? run.events.some((event) => event.kind === 'completion') &&
        run.events.some((event) => event.kind === 'shutdown')
      : waitReportsExercised(run.waitReports);
  const churned = run.churnDroids === undefined || droidChurnExercised(run.churnDroids);
  return exercised && churned && !run.exited ? 'survived' : 'unproven';
}
function first(run: ScopeLeakRun, kind: LogEventKind): number | undefined {
  return run.events.find((event) => event.kind === kind)?.atMs;
}
function after(from: number | undefined, to: number | undefined): string {
  return from === undefined || to === undefined
    ? ''
    : `, ${((to - from) / 1000).toFixed(1)}s after the completion notice`;
}
export function describeRun(run: ScopeLeakRun): string {
  if (run.flagRefresh !== undefined) {
    const evidence = run.flagRefresh;
    return `${flagOutcome(evidence)}; flag refresh ${JSON.stringify(evidence)}; coverage ${flagCoverage(evidence).join('; ') || 'proved'}`;
  }
  const outcome = outcomeOf(run);
  const completion = first(run, 'completion');
  const shutdown = first(run, 'shutdown');
  const late = run.events.filter((event) => event.kind === 'late-callback').length;
  const parts: string[] = [];
  if (run.churnDroids !== undefined) {
    parts.push(
      `project droid churn: ${run.churnDroids.mutations.length}/3 mutations, ${run.churnDroids.events.filter((event) => event.kind === 'file-change').length} watcher events, ${run.churnDroids.events.filter((event) => event.kind === 'registration').length} re-registrations; ${droidChurnExercised(run.churnDroids) ? 'all three parent reloads observed' : 'parent reload coverage missing, so churn is unproven'}`,
    );
  }
  if (run.waitReports !== undefined) {
    const evidence = run.waitReports;
    parts.push(
      `blocking reports: ${evidence.launched}/14 launched, ${evidence.waitsStarted}/14 waits started, ${evidence.waitsFinished}/11 waits finished, ${evidence.completed}/11 completed reports, ${evidence.tornDown}/11 child task managers torn down, ${evidence.closedHosts}/11 hosts closed, ${evidence.quickReplies}/11 stub replies, ${evidence.heldPending}/3 held pending; main ${evidence.mainState || 'unknown'}, observed ${(evidence.observedAfterTeardownMs / 1000).toFixed(1)}s after last teardown`,
    );
    for (const child of [evidence.responsesChild, evidence.responsesFollowup]) {
      if (child === undefined) {
        continue;
      }
      parts.push(
        `Responses child ${child.sessionId || 'unknown'}: ${child.requests}/2 HTTP requests, report ${child.completed}, host closed ${child.closed}, teardown ${child.tornDown}, last quick teardown ${child.lastTeardown}; teardown ${child.teardownMs}, host close ${child.closedMs}, first bytes ${child.streams.map((stream) => stream.firstWriteMs).join(',')}`,
      );
    }
    if (evidence.toolMix !== undefined) {
      parts.push(describeMix(evidence.toolMix));
    }
  }
  if (outcome === 'crashed') {
    parts.push(
      `the window exited with "${SCOPE_DISPOSED}"${after(completion, first(run, 'crash'))}`,
    );
  } else if (outcome === 'survived') {
    parts.push(
      run.waitReports === undefined
        ? 'the window kept running through the held turn after the sub-agent finished'
        : 'the window survived the exercised blocking-report scenario',
    );
  } else if (run.exited) {
    parts.push('the window exited without the scope error, so the run proves nothing');
  } else if (run.waitReports === undefined) {
    parts.push(
      'the sub-agent never finished and shut its task manager down, so the leak was not exercised',
    );
  } else {
    parts.push('required blocking-report coverage is missing, so the run proves nothing');
  }
  if (shutdown !== undefined) {
    parts.push(`its task manager shut down${after(completion, shutdown)}`);
  }
  if (late > 0) {
    parts.push(`${late} late callback(s) hit the disposed scope`);
  }
  return parts.join('; ');
}
export function describeTally(runs: readonly ScopeLeakRun[]): string {
  const binaries = [...new Set(runs.map((run) => run.binary))];
  return binaries
    .map((binary) => {
      const own = runs.filter((run) => run.binary === binary);
      const count = (outcome: Outcome) => own.filter((run) => outcomeOf(run) === outcome).length;
      return `${binary}: crashed ${count('crashed')}/${own.length}, survived ${count('survived')}, unproven ${count('unproven')}`;
    })
    .join('\n');
}
