import type { BodyRow, Json, JsonObject } from './bodies.ts';
import { compactionKind } from './compaction-replay-bodies.ts';
import { parseJson } from './fields.ts';

interface Message {
  role: string;
  content: JsonObject[];
}

export interface RebuildInput {
  sessionId: string;
  records: readonly JsonObject[];
  templates: readonly BodyRow[];
  compactions: readonly number[];
  keepLastTurn: boolean;
}

interface Position {
  k: number;
  stops: readonly number[];
}

export const SUMMARY_WRAPPER_HEAD =
  'A previous instance of Droid has summarized the conversation thus far as follows:\n\n<summary>\n';
export const SUMMARY_WRAPPER_TAIL =
  '\n</summary>\n\nIMPORTANT: This summary was created by a previous instance of Droid. Files referenced in the summary may not be available until you explicitly view them again.';

const API_KEYS: ReadonlyMap<string, readonly string[]> = new Map([
  ['thinking', ['type', 'signature', 'thinking']],
  ['redacted_thinking', ['type', 'data']],
  ['text', ['type', 'text']],
  ['tool_use', ['type', 'id', 'name', 'input']],
  ['tool_result', ['type', 'tool_use_id', 'content', 'is_error']],
  ['image', ['type', 'source']],
]);
const CONTEXT_ID_PREFIX = 'context-';
const CONTEXT_BLOCKS = 2;
const FIRST_CACHED_BLOCK = 2;
const END_CACHED_BLOCK = 4;
const ID_CHARS = 8;
const LINE_PREVIEW_CHARS = 80;
const CACHE_CONTROL: JsonObject = { type: 'ephemeral' };

function isObject(value: Json | undefined): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isList(value: Json | undefined): value is readonly Json[] {
  return Array.isArray(value);
}

function textOf(value: Json | undefined): string {
  return typeof value === 'string' ? value : '';
}

function objectsAt(record: JsonObject, key: string): JsonObject[] {
  const value = record[key];
  if (!isList(value) || !value.every((item) => isObject(item))) {
    throw new TypeError(`expected "${key}" to be a list of objects`);
  }
  return value.filter((item) => isObject(item));
}

function isRecordLine(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function recordOf(line: string): JsonObject {
  const record = parseJson(line, isRecordLine);
  if (record === undefined) {
    throw new TypeError(
      `a session line is not a JSON object: ${line.slice(0, LINE_PREVIEW_CHARS)}`,
    );
  }
  return record;
}

export function sessionRecords(text: string): JsonObject[] {
  return text
    .split('\n')
    .filter((line) => line.trim() !== '')
    .map((line) => recordOf(line));
}

function apiBlock(block: JsonObject): JsonObject {
  const keys = API_KEYS.get(textOf(block['type']));
  if (keys === undefined) {
    return block;
  }
  return Object.fromEntries(
    keys
      .filter((key) => key in block && !(key === 'is_error' && block[key] === false))
      .map((key) => [key, block[key] ?? null]),
  );
}

function cached(block: JsonObject): JsonObject {
  return { ...block, cache_control: CACHE_CONTROL };
}

function messageOf(record: JsonObject): Message | undefined {
  const { message } = record;
  if (record['type'] !== 'message' || !isObject(message)) {
    return undefined;
  }
  const content = objectsAt(message, 'content');
  return content.length === 0
    ? undefined
    : { role: textOf(message['role']), content: content.map((block) => apiBlock(block)) };
}

function withoutLastTurn(messages: readonly Message[]): Message[] {
  const last = messages.findLastIndex((message) => message.role === 'assistant');
  if (last === -1) {
    throw new Error('the transcript has no assistant message, so it has no last turn to leave out');
  }
  return messages.slice(0, last);
}

interface Span {
  afterId: string | undefined;
  stop: number;
  keepLastTurn: boolean;
}

function transcriptBetween(records: readonly JsonObject[], span: Span): Message[] {
  const { afterId, stop, keepLastTurn } = span;
  const anchorAt =
    afterId === undefined ? -1 : records.findIndex((record) => record['id'] === afterId);
  if (afterId !== undefined && anchorAt === -1) {
    throw new Error(`the anchor message ${afterId} is not in the session`);
  }
  const messages = records
    .slice(anchorAt + 1, stop)
    .map((record) => messageOf(record))
    .filter((message) => message !== undefined);
  const kept = keepLastTurn ? messages : withoutLastTurn(messages);
  if (kept.length === 0) {
    throw new Error('no transcript messages are left to summarize');
  }
  return kept;
}

function cacheBlocks(message: Message, from: number, end: number): Message {
  return {
    ...message,
    content: message.content.map((block, at) => (at >= from && at < end ? cached(block) : block)),
  };
}

function cacheLast(messages: readonly Message[]): Message[] {
  return messages.map((message, at) =>
    at === messages.length - 1
      ? cacheBlocks(message, message.content.length - 1, message.content.length)
      : message,
  );
}

function openingText(body: JsonObject): string {
  const { messages } = body;
  const first = isList(messages) ? messages[0] : undefined;
  const content = isObject(first) ? first['content'] : undefined;
  if (typeof content === 'string') {
    return content;
  }
  const block = isList(content) ? content[0] : undefined;
  return isObject(block) ? textOf(block['text']) : '';
}

function templateFor(templates: readonly BodyRow[], later: boolean): BodyRow {
  const found = templates.find(
    (row) =>
      compactionKind(row.body) === 'reuse' &&
      openingText(row.body).startsWith(SUMMARY_WRAPPER_HEAD) === later,
  );
  if (found === undefined) {
    const need = later ? 'is' : 'is not';
    throw new Error(
      `the template file holds no ${later ? 'later' : 'first'} compaction request: it needs a reuse compaction whose first message ${need} the summary wrapper`,
    );
  }
  return found;
}

function laterHead(previous: JsonObject, context: JsonObject): Message[] {
  const contextMessage = messageOf(context);
  if (contextMessage === undefined) {
    throw new Error('the context message is empty');
  }
  return [
    {
      role: 'user',
      content: [
        {
          type: 'text',
          text: `${SUMMARY_WRAPPER_HEAD}${textOf(previous['summaryText'])}${SUMMARY_WRAPPER_TAIL}`,
        },
        cached({ type: 'text', text: textOf(previous['systemInfoText']) }),
      ],
    },
    { role: 'user', content: contextMessage.content.slice(0, CONTEXT_BLOCKS) },
  ];
}

function stopOf({ k, stops }: Position): number {
  const stop = stops[k - 1];
  if (k < 1 || stop === undefined) {
    throw new Error(
      `the session has ${stops.length} compactions, so compaction ${k} does not exist`,
    );
  }
  return stop;
}

function firstMessages(input: RebuildInput, position: Position): Message[] {
  const transcript = transcriptBetween(input.records, {
    afterId: undefined,
    stop: stopOf(position),
    keepLastTurn: input.keepLastTurn,
  });
  return cacheLast(
    transcript.map((message, at) =>
      at === 0 ? cacheBlocks(message, FIRST_CACHED_BLOCK, END_CACHED_BLOCK) : message,
    ),
  );
}

function laterMessages(input: RebuildInput, position: Position): Message[] {
  const previous = input.records[position.stops[position.k - 2] ?? -1];
  const anchor = previous?.['anchorMessage'];
  const context = input.records.find(
    (record) => record['type'] === 'message' && textOf(record['id']).startsWith(CONTEXT_ID_PREFIX),
  );
  if (previous === undefined || !isObject(anchor) || context === undefined) {
    throw new Error('the session has no context message, or the previous compaction has no anchor');
  }
  const transcript = transcriptBetween(input.records, {
    afterId: textOf(anchor['id']),
    stop: stopOf(position),
    keepLastTurn: input.keepLastTurn,
  });
  return [...laterHead(previous, context), ...cacheLast(transcript)];
}

function rebuildOne(input: RebuildInput, position: Position): BodyRow {
  const template = templateFor(input.templates, position.k > 1);
  const templateMessages = template.body['messages'];
  const instruction = isList(templateMessages) ? templateMessages.at(-1) : undefined;
  if (instruction === undefined) {
    throw new Error('the template request has no messages');
  }
  const messages =
    position.k === 1 ? firstMessages(input, position) : laterMessages(input, position);
  return {
    t: template.t,
    sessionId: input.sessionId,
    assistantMessageId: `rebuild-${input.sessionId.slice(0, ID_CHARS)}-${position.k}`,
    route: template.route,
    body: {
      ...template.body,
      messages: [...messages.map(({ role, content }) => ({ role, content })), instruction],
    },
  };
}

export function rebuildCompactions(input: RebuildInput): BodyRow[] {
  const stops = input.records.flatMap((record, at) =>
    record['type'] === 'compaction_state' ? [at] : [],
  );
  const wanted =
    input.compactions.length === 0 ? stops.map((_stop, at) => at + 1) : input.compactions;
  return wanted.map((k) => rebuildOne(input, { k, stops }));
}
