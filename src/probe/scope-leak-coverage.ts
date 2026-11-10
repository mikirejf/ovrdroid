import { entriesOf, fieldsOf, resultText, worded } from './fields.ts';
import type { ResponsesRequest } from './scope-leak-responses.ts';
import { mixExercised } from './scope-leak-tool-mix.ts';
import type { MixChildEvidence } from './scope-leak-tool-mix.ts';
import type { ToolCall } from './stub-model.ts';

export const WAIT_CHILDREN = 14;
export const QUICK_CHILDREN = 11;
export const WAIT_TIMEOUT_MS = 1_200_000;
export const WAIT_MAIN_MODEL = 'stub-scope-main';
export const WAIT_DROID = 'ovrdroid-scope-wait';
export const RESPONSES_CHILD = QUICK_CHILDREN - 1;
export const FOLLOWUP_CHILD = RESPONSES_CHILD - 1;
export function waitLaunches(
  run: string,
  responsesChild = false,
  responsesFollowup = false,
): (ToolCall & { id: string })[] {
  return Array.from({ length: WAIT_CHILDREN }, (_, index) => {
    let kind = index < QUICK_CHILDREN ? 'quick' : 'held';
    if (
      (responsesChild && index === RESPONSES_CHILD) ||
      (responsesFollowup && index === FOLLOWUP_CHILD)
    ) {
      kind = 'responses';
    }
    return {
      id: `toolu_scope_${run}_${index}`,
      name: 'Task',
      input: {
        subagent_type: `${WAIT_DROID}-${kind}`,
        description: `scope child ${index}`,
        prompt: `hold:scope${index}`,
        run_in_background: true,
      },
    };
  });
}
export function waitCalls(body: unknown, run: string): ToolCall[] {
  const messages = entriesOf(fieldsOf(body), 'messages');
  const results = messages.flatMap((message) => entriesOf(message, 'content'));
  return waitLaunches(run).map((launch, index) => {
    const result = results.find(
      (block) =>
        worded(block, 'type') === 'tool_result' && worded(block, 'tool_use_id') === launch.id,
    );
    const task =
      result === undefined
        ? undefined
        : /(?:^|\n)task_id: (?<id>\S+)/u.exec(resultText(result))?.groups?.['id'];
    if (task === undefined || result?.get('is_error') === true) {
      throw new Error(`scope child ${index} has no successful Task launch result`);
    }
    return {
      id: `toolu_wait_${run}_${index}`,
      name: 'TaskOutput',
      input: { task_id: task, block: true, timeout: WAIT_TIMEOUT_MS },
    };
  });
}
export function childWorkDone(body: unknown): boolean {
  return entriesOf(fieldsOf(body), 'messages').some((message) =>
    entriesOf(message, 'content').some(
      (block) =>
        worded(block, 'type') === 'tool_result' &&
        worded(block, 'tool_use_id').startsWith('toolu_work'),
    ),
  );
}
export function responsesWorkDone(body: unknown): boolean {
  return entriesOf(fieldsOf(body), 'input').some(
    (item) =>
      ['function_call_output', 'custom_tool_call_output'].includes(worded(item, 'type')) &&
      worded(item, 'call_id').startsWith('call_work'),
  );
}
export interface ResponsesChildEvidence {
  sessionId: string;
  requests: number;
  completed: boolean;
  closed: boolean;
  tornDown: boolean;
  lastTeardown: boolean;
  teardownMs: number;
  closedMs: number;
  streams: ResponsesRequest[];
}
export interface WaitReportsEvidence {
  launched: number;
  waitsStarted: number;
  waitsFinished: number;
  completed: number;
  tornDown: number;
  heldPending: number;
  quickReplies: number;
  closedHosts: number;
  mainState: string;
  observedAfterTeardownMs: number;
  responsesChild?: ResponsesChildEvidence;
  responsesFollowup?: ResponsesChildEvidence;
  toolMix?: MixChildEvidence[];
}
function responsesExercised(evidence: WaitReportsEvidence): boolean {
  const r1 = evidence.responsesChild;
  const r2 = evidence.responsesFollowup;
  const firstByte = r2?.streams[0]?.firstWriteMs ?? 0;
  const endedMs = r1?.streams[1]?.endedMs ?? 0;
  const complete = [r1, r2].every(
    (child) =>
      child === undefined ||
      (child.sessionId !== '' &&
        child.requests >= 2 &&
        child.completed &&
        child.closed &&
        child.tornDown),
  );
  if (r2 === undefined) {
    return complete && r1?.lastTeardown !== false;
  }
  return (
    complete &&
    r1 !== undefined &&
    r1.sessionId !== r2.sessionId &&
    r2.lastTeardown &&
    r1.teardownMs > 0 &&
    r1.closedMs > 0 &&
    firstByte > Math.max(r1.teardownMs, r1.closedMs) &&
    endedMs > 0 &&
    firstByte >= endedMs + 3000 &&
    r2.streams.length >= 2 &&
    r2.streams.every((stream) => stream.endedMs - stream.firstWriteMs > 1000)
  );
}
export function waitReportsExercised(evidence: WaitReportsEvidence): boolean {
  return (
    evidence.launched === WAIT_CHILDREN &&
    evidence.waitsStarted === WAIT_CHILDREN &&
    [
      evidence.waitsFinished,
      evidence.completed,
      evidence.tornDown,
      evidence.quickReplies,
      evidence.closedHosts,
    ].every((count) => count === QUICK_CHILDREN) &&
    evidence.heldPending === WAIT_CHILDREN - QUICK_CHILDREN &&
    evidence.mainState === 'executing_tool' &&
    evidence.observedAfterTeardownMs >= 30_000 &&
    responsesExercised(evidence) &&
    (evidence.toolMix === undefined || mixExercised(evidence.toolMix))
  );
}
