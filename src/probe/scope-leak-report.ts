import type { Fields } from './fields.ts';
import { entriesOf, fieldsOf, worded } from './fields.ts';
import { LAUNCH_WORD, answerFor } from './rewind-report.ts';

export { HOLD_WORD, LAUNCH_WORD } from './rewind-report.ts';

export const NOTICE_START = 'Background task';
export const SCOPE_DISPOSED = 'Agent runtime scope is disposed';

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
  binary: string;
  exited: boolean;
  events: readonly LogEvent[];
}

export type Outcome = 'crashed' | 'survived' | 'unproven';

export function outcomeOf(run: ScopeLeakRun): Outcome {
  if (run.events.some((event) => event.kind === 'crash')) {
    return 'crashed';
  }
  const exercised =
    run.events.some((event) => event.kind === 'completion') &&
    run.events.some((event) => event.kind === 'shutdown');
  return exercised && !run.exited ? 'survived' : 'unproven';
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
  const outcome = outcomeOf(run);
  const completion = first(run, 'completion');
  const shutdown = first(run, 'shutdown');
  const late = run.events.filter((event) => event.kind === 'late-callback').length;
  const parts: string[] = [];
  if (outcome === 'crashed') {
    parts.push(
      `the window exited with "${SCOPE_DISPOSED}"${after(completion, first(run, 'crash'))}`,
    );
  } else if (outcome === 'survived') {
    parts.push('the window kept running through the held turn after the sub-agent finished');
  } else {
    parts.push(
      run.exited
        ? 'the window exited without the scope error, so the run proves nothing'
        : 'the sub-agent never finished and shut its task manager down, so the leak was not exercised',
    );
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
