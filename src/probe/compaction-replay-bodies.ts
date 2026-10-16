import {
  CUSTOM_INSTRUCTIONS_LEAD,
  NO_MENTION_LINE,
  SUMMARIZE_LINE,
} from '../patch/compaction-patches.ts';
import type { Json, JsonObject } from './bodies.ts';
import { fieldsOf, worded } from './fields.ts';

export type CompactionKind = 'reuse' | 'stock';
export type BodyFormat = 'messages' | 'responses';

interface Layout {
  list: string;
  text: string;
}

const LAYOUTS: Record<BodyFormat, Layout> = {
  messages: { list: 'messages', text: 'text' },
  responses: { list: 'input', text: 'input_text' },
};

interface Ask {
  summarizer: string;
  custom: string;
}

export const STOCK_SYSTEM_MARK = 'You excel at creating and maintaining summaries';
export const THINKING_CHARS = 500;
export const INLINE_TOOLS_BETA = 'inline-tools-2026-09-15';

const CLAIM_SENTENCE =
  'This message is a system request, not part of the conversation, so do not mention it. ';
const NO_MENTION_SENTENCE = 'This message is a system request, not part of the conversation. ';
const NO_CLAIM_SENTENCE = 'Do not mention this request. ';

const ASK_LINES = [SUMMARIZE_LINE, NO_MENTION_LINE];
const CUSTOM_BREAK = `\n\n${CUSTOM_INSTRUCTIONS_LEAD}\n`;
const MESSAGE_BREAK = '\n\n---\n\n';

function isList(value: Json | undefined): value is readonly Json[] {
  return Array.isArray(value);
}

function isRecord(value: Json | undefined): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asList(value: Json | undefined): readonly Json[] {
  return isList(value) ? value : [];
}

export function bodyFormat(body: JsonObject): BodyFormat | undefined {
  if (Array.isArray(body['input'])) {
    return 'responses';
  }
  return Array.isArray(body['messages']) ? 'messages' : undefined;
}

function layoutOf(body: JsonObject): Layout {
  return LAYOUTS[bodyFormat(body) ?? 'messages'];
}

function lastMessage(body: JsonObject): JsonObject | undefined {
  const last = asList(body[layoutOf(body).list]).at(-1);
  return isRecord(last) ? last : undefined;
}

function lastTextIndex(body: JsonObject, message: JsonObject): number {
  const { text } = layoutOf(body);
  return asList(message['content']).findLastIndex(
    (block) => worded(fieldsOf(block), 'type') === text,
  );
}

function lastText(body: JsonObject): string | undefined {
  const message = lastMessage(body);
  if (message?.['role'] !== 'user') {
    return undefined;
  }
  const { content } = message;
  if (typeof content === 'string') {
    return content;
  }
  const at = lastTextIndex(body, message);
  return at === -1 ? undefined : worded(fieldsOf(asList(content)[at]), 'text');
}

function askLineIn(text: string): string | undefined {
  return ASK_LINES.find((line) => text.includes(`\n\n${line}`));
}

function askOf(body: JsonObject): Ask | undefined {
  const text = lastText(body);
  const line = text === undefined ? undefined : askLineIn(text);
  if (text === undefined || line === undefined) {
    return undefined;
  }
  const askBreak = `\n\n${line}`;
  const at = text.indexOf(askBreak);
  const tail = text.slice(at + askBreak.length);
  return {
    summarizer: text.slice(0, at),
    custom: tail.startsWith(CUSTOM_BREAK) ? tail.slice(CUSTOM_BREAK.length) : '',
  };
}

function askOrThrow(body: JsonObject): Ask {
  const ask = askOf(body);
  if (ask === undefined) {
    throw new Error('the body is not a reuse compaction request');
  }
  return ask;
}

export function compactionKind(body: JsonObject): CompactionKind | undefined {
  if (askOf(body) !== undefined) {
    return 'reuse';
  }
  if (bodyFormat(body) === 'responses') {
    return undefined;
  }
  return JSON.stringify(body['system'] ?? null).includes(STOCK_SYSTEM_MARK) ? 'stock' : undefined;
}

function askBlock(body: JsonObject): JsonObject {
  const message = lastMessage(body);
  const blocks = asList(message?.['content']);
  const [only] = blocks;
  if (
    message?.['role'] !== 'user' ||
    blocks.length !== 1 ||
    !isRecord(only) ||
    worded(fieldsOf(only), 'type') !== layoutOf(body).text
  ) {
    throw new Error('the last message is not a user message with exactly one text block');
  }
  if (askLineIn(worded(fieldsOf(only), 'text')) === undefined) {
    throw new Error('the last text block does not hold a summarize line');
  }
  return only;
}

function askBlockText(body: JsonObject): string {
  return worded(fieldsOf(askBlock(body)), 'text');
}

function withAskText(body: JsonObject, from: string, to: string): JsonObject {
  const block = askBlock(body);
  const text = askBlockText(body);
  if (!text.includes(from)) {
    throw new Error(`the ask does not hold the sentence to change: ${from}`);
  }
  const { list } = layoutOf(body);
  return {
    ...body,
    [list]: [
      ...asList(body[list]).slice(0, -1),
      { ...lastMessage(body), content: [{ ...block, text: text.replace(from, () => to) }] },
    ],
  };
}

function messagesOnly(body: JsonObject, arm: string): void {
  if (bodyFormat(body) === 'responses') {
    throw new Error(`the ${arm} arm needs a Messages-format body, not a Responses one`);
  }
}

export function noMentionBody(body: JsonObject): JsonObject {
  return withAskText(body, CLAIM_SENTENCE, NO_MENTION_SENTENCE);
}

export function noClaimBody(body: JsonObject): JsonObject {
  return withAskText(body, CLAIM_SENTENCE, NO_CLAIM_SENTENCE);
}

function toolNames(body: JsonObject): string[] {
  return asList(body['tools']).map((tool) => worded(fieldsOf(tool), 'name'));
}

export function systemBody(body: JsonObject): JsonObject {
  messagesOnly(body, 'system');
  const text = askBlockText(body);
  const removals = toolNames(body).map((name) => ({
    type: 'tool_removal',
    tool: { type: 'tool_reference', name },
  }));
  return {
    ...body,
    messages: [
      ...asList(body['messages']).slice(0, -1),
      { role: 'system', content: [{ type: 'text', text }, ...removals] },
    ],
  };
}

function resultText(content: unknown): string {
  if (typeof content === 'string') {
    return content;
  }
  const parts: readonly unknown[] = Array.isArray(content) ? content : [];
  return parts
    .map((part) => {
      const fields = fieldsOf(part);
      return worded(fields, 'type') === 'text' ? worded(fields, 'text') : '[Image]';
    })
    .join('\n');
}

function blockText(block: Json): string {
  const fields = fieldsOf(block);
  const type = worded(fields, 'type');
  switch (type) {
    case 'text': {
      return worded(fields, 'text');
    }
    case 'tool_use': {
      return `TOOL_CALL: ${worded(fields, 'name')} input=${JSON.stringify(fields.get('input'))}`;
    }
    case 'tool_result': {
      return `TOOL_RESULT: ${resultText(fields.get('content'))}`;
    }
    case 'thinking': {
      const thinking = worded(fields, 'thinking');
      const more = thinking.length > THINKING_CHARS ? '...' : '';
      return `[Thinking: ${thinking.slice(0, THINKING_CHARS)}${more}]`;
    }
    case 'redacted_thinking': {
      return '[Redacted thinking]';
    }
    case 'image': {
      return '[Image attached]';
    }
    default: {
      return `[Unknown block type: ${type}]`;
    }
  }
}

function messageText(message: Json): string {
  const label = worded(fieldsOf(message), 'role').toUpperCase();
  const content = isRecord(message) ? message['content'] : undefined;
  if (typeof content === 'string') {
    return `${label}: ${content}`;
  }
  const shown = asList(content).filter((block) => {
    const fields = fieldsOf(block);
    return worded(fields, 'type') !== 'thinking' || worded(fields, 'thinking') !== '';
  });
  return `${label}: ${shown.map((block) => blockText(block)).join('\n')}`;
}

export function flatten(messages: readonly Json[]): string {
  return messages.map((message) => messageText(message)).join(MESSAGE_BREAK);
}

export function stockUserContent(transcript: string, custom: string): string {
  const instructions =
    custom === ''
      ? ''
      : `\n\nThe user has provided the following instructions for this summary:\n${custom}\n\nIf necessary, you may add new sections or modify existing ones to align with the user's intent.`;
  return `Please summarize the following conversation:\n\`\`\`\n${transcript}\n\`\`\`${instructions}\n\nRemember to wrap your final summary in <summary> tags.`;
}

export function stockBody(body: JsonObject): JsonObject {
  messagesOnly(body, 'stock');
  const { summarizer, custom } = askOrThrow(body);
  const transcript = flatten(asList(body['messages']).slice(0, -1));
  const kept = Object.fromEntries(Object.entries(body).filter(([key]) => key !== 'tools'));
  return {
    ...kept,
    system: [{ type: 'text', text: summarizer }],
    messages: [
      {
        role: 'user',
        content: [
          {
            type: 'text',
            text: stockUserContent(transcript, custom),
            cache_control: { type: 'ephemeral' },
          },
        ],
      },
    ],
  };
}
