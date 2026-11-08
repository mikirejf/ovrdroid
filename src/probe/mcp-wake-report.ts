import { MS_PER_SECOND } from '../cli.ts';
import { entriesOf, fieldsOf, worded } from './fields.ts';
import { FIXTURE_NAME, FIXTURE_REPLY, FIXTURE_TOOL, FIXTURE_TOOL_NAME } from './mcp-fixture.ts';
import {
  OFFER_WORDS,
  readingFailure,
  readToolTurn,
  textsOf,
  toolUsesSince,
  usedToolSince,
} from './mcp-tool-turn.ts';
import type { Scope, ToolTurnReading } from './mcp-tool-turn.ts';
import { toolNamesIn, toolResultsIn } from './stale-edit-cases.ts';

export const WAKE_IDLE_MS = 2000;
export const IDLE_SLACK_MS = 500;
export const STOP_LIMIT_MS = WAKE_IDLE_MS + 15 * MS_PER_SECOND;

export const LAUNCH_WORD = 'SLEEPWAKE-LAUNCH';
export const CHILD_WORD = 'sleepwake-child:';
export const FIRST_WORD = 'SLEEPWAKE-FIRST';
export const WAKE_WORD = 'SLEEPWAKE-AGAIN';

export const CHILD_SCOPE: Scope = { marker: CHILD_WORD, tag: 'sub' };
export const FIRST_SCOPE: Scope = { marker: FIRST_WORD, tag: 'first' };
export const WAKE_SCOPE: Scope = { marker: WAKE_WORD, tag: 'wake' };

export type Role = 'plain' | 'child' | 'launch' | 'first' | 'wake';

const PROMPT_ROLES: readonly (readonly [string, Role])[] = [
  [LAUNCH_WORD, 'launch'],
  [FIRST_WORD, 'first'],
  [WAKE_WORD, 'wake'],
];

export interface StagedRequest {
  role: Role;
  body: unknown;
}

export interface WakeEvidence {
  requests: readonly StagedRequest[];
  childSawRunning: boolean | undefined;
  quietBeforeFirst: boolean;
  stoppedAfterMs: number | undefined;
}

export interface WakeReading {
  child: ToolTurnReading;
  childSawRunning: boolean;
  quietBeforeFirst: boolean;
  first: ToolTurnReading;
  stoppedAfterMs: number | undefined;
  wake: ToolTurnReading;
}

function openingTexts(body: unknown): string[] {
  const messages = entriesOf(fieldsOf(body), 'messages');
  const end = messages.findIndex((message) => worded(message, 'role') === 'assistant');
  return (end === -1 ? messages : messages.slice(0, end))
    .filter((message) => worded(message, 'role') === 'user')
    .flatMap((message) => textsOf(message));
}

function lastPromptRole(body: unknown): Role {
  const roles = entriesOf(fieldsOf(body), 'messages')
    .filter((message) => worded(message, 'role') === 'user')
    .flatMap((message) => textsOf(message))
    .flatMap((text) =>
      PROMPT_ROLES.filter(([word]) => text.includes(word)).map(([, role]) => role),
    );
  return roles.at(-1) ?? 'plain';
}

export function roleOf(body: unknown): Role {
  if (toolNamesIn(body).length === 0) {
    return 'plain';
  }
  if (openingTexts(body).some((text) => text.includes(CHILD_WORD))) {
    return 'child';
  }
  return lastPromptRole(body);
}

const TASK_TOOL = 'Task';

export function launchesSubagent(body: unknown): boolean {
  return toolNamesIn(body).includes(TASK_TOOL) && !usedToolSince(body, TASK_TOOL, LAUNCH_WORD);
}

function pongedCalls(bodies: readonly unknown[], marker: string): Set<string> {
  const ids = new Set<string>();
  for (const body of bodies) {
    const results = toolResultsIn(body);
    for (const use of toolUsesSince(body, marker)) {
      const result = results.get(use.id);
      if (
        use.name === FIXTURE_TOOL_NAME &&
        result !== undefined &&
        !result.isError &&
        result.text.includes(FIXTURE_REPLY)
      ) {
        ids.add(use.id);
      }
    }
  }
  return ids;
}

export function readWake(evidence: WakeEvidence): WakeReading {
  const bodiesOf = (role: Role) =>
    evidence.requests.filter((request) => request.role === role).map((request) => request.body);
  const wakeBodies = bodiesOf('wake');
  return {
    child: readToolTurn(bodiesOf('child'), FIXTURE_TOOL_NAME),
    childSawRunning: evidence.childSawRunning === true,
    quietBeforeFirst: evidence.quietBeforeFirst,
    first: readToolTurn(bodiesOf('first'), FIXTURE_TOOL_NAME),
    stoppedAfterMs: evidence.stoppedAfterMs,
    wake: {
      ...readToolTurn(wakeBodies, FIXTURE_TOOL_NAME),
      ponged: pongedCalls(wakeBodies, WAKE_WORD).size > 0,
    },
  };
}

function seconds(ms: number): string {
  return `${(ms / MS_PER_SECOND).toFixed(1)}s`;
}

function subagentFailures(reading: WakeReading): string[] {
  if (reading.child.requests === 0) {
    return [
      'sub-agent: no request from a sub-agent reached the model, so the Task call never ran one',
    ];
  }
  const failures: string[] = [];
  if (reading.childSawRunning) {
    failures.push(
      `sub-agent: ${FIXTURE_NAME} was already running when the sub-agent started, so the sub-agent did not see a dormant server`,
    );
  }
  const failure = readingFailure('sub-agent', reading.child, !reading.childSawRunning);
  if (failure !== undefined) {
    failures.push(failure);
  }
  return failures;
}

function stopFailure(stoppedAfterMs: number | undefined): string | undefined {
  if (stoppedAfterMs === undefined) {
    return `idle stop: ${FIXTURE_NAME} was still running ${seconds(STOP_LIMIT_MS)} after the main agent's call, with the idle time set to ${seconds(WAKE_IDLE_MS)}`;
  }
  if (stoppedAfterMs < WAKE_IDLE_MS - IDLE_SLACK_MS) {
    return `idle stop: the server was gone ${seconds(stoppedAfterMs)} after the call, before the ${seconds(WAKE_IDLE_MS)} idle time: something other than the idle stop took it down`;
  }
  return undefined;
}

export function wakeFailures(reading: WakeReading): string[] {
  const failures = subagentFailures(reading);
  if (!reading.child.ponged) {
    return failures;
  }
  if (!reading.quietBeforeFirst) {
    failures.push(
      `${FIXTURE_NAME} was still running ${seconds(STOP_LIMIT_MS)} after the sub-agent finished, so the main agent's first call could not show a wake`,
    );
    return failures;
  }
  const first = readingFailure("main agent's first call", reading.first, true);
  if (first !== undefined) {
    failures.push(first);
    return failures;
  }
  const stop = stopFailure(reading.stoppedAfterMs);
  if (stop !== undefined) {
    failures.push(stop);
    return failures;
  }
  const wake = readingFailure('main agent after the stop', reading.wake, false);
  if (wake !== undefined) {
    failures.push(wake);
  }
  return failures;
}

export function wakePassed(reading: WakeReading): string {
  const stopped = seconds(reading.stoppedAfterMs ?? 0);
  return `a sub-agent was offered ${FIXTURE_NAME}'s tools and got ${FIXTURE_REPLY} from a dormant server, the main agent's call then woke the server, the idle stop took it down ${stopped} after that call (idle time ${seconds(WAKE_IDLE_MS)}), and the next call woke it and got ${FIXTURE_REPLY} again`;
}

function offerLine(label: string, reading: ToolTurnReading): string {
  const offered = reading.offered === undefined ? 'not offered' : OFFER_WORDS[reading.offered];
  const answer = reading.ponged ? `${FIXTURE_REPLY} came back` : `no ${FIXTURE_REPLY}`;
  return `${label}: ${FIXTURE_TOOL} ${offered}, ${answer}`;
}

function stopLine(reading: WakeReading): string {
  if (reading.stoppedAfterMs === undefined) {
    return `idle stop: the server was still running ${seconds(STOP_LIMIT_MS)} after the main agent's call (idle time ${seconds(WAKE_IDLE_MS)})`;
  }
  return `idle stop: the server stopped ${seconds(reading.stoppedAfterMs)} after the main agent's call (idle time ${seconds(WAKE_IDLE_MS)})`;
}

export function describeWake(reading: WakeReading): string {
  const lines = [
    `one session with the idle time at ${seconds(WAKE_IDLE_MS)}, Droid's own tool copy deleted:`,
    `${offerLine('sub-agent', reading.child)}, server ${reading.childSawRunning ? 'already running' : 'dormant'} when it started`,
    `sub-agent finished: server ${reading.quietBeforeFirst ? 'gone' : 'still running'} before the main agent's first call`,
    offerLine("main agent's first call", reading.first),
    stopLine(reading),
    offerLine('main agent after the stop', reading.wake),
  ];
  return lines.map((line, at) => (at === 0 ? line : `  ${line}`)).join('\n');
}
