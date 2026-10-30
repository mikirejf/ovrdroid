import { FACTORY_SESSIONS } from '../paths.ts';
import { entriesOf, fieldsOf, fieldsOfJson, worded } from './fields.ts';
import type { Fields } from './fields.ts';

export const HIDDEN_FROM_MODEL = 'user_only';
const TURN_OUTCOME = 'agent_turn_outcome';

export interface Transcript {
  id: string;
  text: string;
}

interface Turn {
  role: string;
  text: string;
  toolUses: number;
  toolResults: number;
  effort: string;
}

export function transcriptFileOf(sessionId: string): string | undefined {
  const [file] = new Bun.Glob(`*/${sessionId}.jsonl`).scanSync({
    cwd: FACTORY_SESSIONS,
    absolute: true,
  });
  return file;
}

export function ofKind(blocks: readonly Fields[], kind: string): Fields[] {
  return blocks.filter((block) => worded(block, 'type') === kind);
}

function turnOf(line: string): Turn | undefined {
  const fields = fieldsOfJson(line);
  if (worded(fields, 'type') !== 'message') {
    return undefined;
  }
  const message = fieldsOf(fields.get('message'));
  if (worded(message, 'visibility') === HIDDEN_FROM_MODEL) {
    return undefined;
  }
  const content = message.get('content');
  const blocks = entriesOf(message, 'content');
  return {
    role: worded(message, 'role'),
    text:
      typeof content === 'string'
        ? content
        : ofKind(blocks, 'text')
            .map((block) => worded(block, 'text'))
            .join(''),
    toolUses: ofKind(blocks, 'tool_use').length,
    toolResults: ofKind(blocks, 'tool_result').length,
    effort: worded(message, 'reasoningEffort'),
  };
}

function turnsOf(text: string): Turn[] {
  return text
    .split('\n')
    .map((line) => turnOf(line))
    .filter((turn) => turn !== undefined);
}

export function callerOf(text: string): string {
  return worded(fieldsOfJson(text.split('\n', 1)[0] ?? ''), 'callingSessionId');
}

export function toolResultCount(text: string): number {
  return turnsOf(text).reduce((sum, turn) => sum + turn.toolResults, 0);
}

function isVisibleMessage(fields: Fields): boolean {
  return (
    worded(fields, 'type') === 'message' &&
    worded(fieldsOf(fields.get('message')), 'visibility') !== HIDDEN_FROM_MODEL
  );
}

export function turnOutcome(text: string): string | undefined {
  let outcome: string | undefined;
  for (const line of text.split('\n')) {
    const fields = fieldsOfJson(line);
    if (isVisibleMessage(fields)) {
      outcome = undefined;
    } else if (worded(fields, 'type') === TURN_OUTCOME) {
      outcome = worded(fields, 'reason');
    }
  }
  return outcome;
}

export function turnEnded(text: string): boolean {
  return turnOutcome(text) !== undefined;
}

function repliesOf(text: string): Turn[] {
  return turnsOf(text).filter(
    (turn) => turn.role === 'assistant' && turn.text.trim() !== '' && turn.toolUses === 0,
  );
}

export function replyCount(text: string): number {
  return repliesOf(text).length;
}

export function replyEfforts(text: string): string[] {
  return repliesOf(text).map((reply) => reply.effort);
}

export function finalReply(text: string): string {
  return (
    turnsOf(text)
      .filter((turn) => turn.role === 'assistant')
      .map((turn) => turn.text.trim())
      .findLast((reply) => reply !== '') ?? ''
  );
}

export function parentOf(transcripts: readonly Transcript[]): Transcript | undefined {
  return transcripts.find(
    ({ text }) => callerOf(text) === '' && turnsOf(text).some((turn) => turn.role === 'assistant'),
  );
}

export function childOf(
  transcripts: readonly Transcript[],
  parentId: string,
): Transcript | undefined {
  return transcripts.find(({ text }) => callerOf(text) === parentId);
}

export interface FinishedChild {
  parent: Transcript;
  child: Transcript;
}

export function finishedChild(
  transcripts: readonly Transcript[],
  parentId: string,
): FinishedChild | undefined {
  const parent = transcripts.find((transcript) => transcript.id === parentId);
  const child = childOf(transcripts, parentId);
  return parent !== undefined && child !== undefined && turnEnded(child.text)
    ? { parent, child }
    : undefined;
}
