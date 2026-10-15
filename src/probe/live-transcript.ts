import { entriesOf, fieldsOf, fieldsOfJson, worded } from './fields.ts';

const HIDDEN_FROM_MODEL = 'user_only';

export interface Transcript {
  id: string;
  text: string;
}

interface Turn {
  role: string;
  text: string;
  toolUses: number;
  toolResults: number;
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
  const ofKind = (kind: string) => blocks.filter((block) => worded(block, 'type') === kind);
  return {
    role: worded(message, 'role'),
    text:
      typeof content === 'string'
        ? content
        : ofKind('text')
            .map((block) => worded(block, 'text'))
            .join(''),
    toolUses: ofKind('tool_use').length,
    toolResults: ofKind('tool_result').length,
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

export function turnEnded(text: string): boolean {
  const turns = turnsOf(text);
  const last = turns.at(-1);
  return (
    last?.role === 'assistant' &&
    last.text.trim() !== '' &&
    last.toolUses === 0 &&
    turns.some((turn) => turn.toolResults > 0)
  );
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
