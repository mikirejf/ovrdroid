import { CUSTOM_INSTRUCTIONS_LEAD, SUMMARIZE_LINE } from '../../patch/compaction-patches.ts';
import type { Json, JsonObject } from '../bodies.ts';
import { STOCK_SYSTEM_MARK } from '../compaction-replay-bodies.ts';

export const SUMMARIZER = 'You write summaries.\n';

export const SUMMARY = [
  '<summary>',
  '1. Chronological Play-by-Play',
  'The user asked for a fix.',
  '2. Approach',
  'Read the parser.',
  '3. Next Steps',
  'Run the tests.',
  '</summary>',
].join('\n');

export const REFUSAL = "I'm not going to write out that summary.\nI am still working.";

export function askText(custom = '', summarizer = SUMMARIZER): string {
  const tail = custom === '' ? '' : `\n\n${CUSTOM_INSTRUCTIONS_LEAD}\n${custom}`;
  return `${summarizer}\n\n${SUMMARIZE_LINE}${tail}`;
}

export function reuseMessages(custom = '', summarizer = SUMMARIZER): JsonObject[] {
  return [
    { role: 'user', content: [{ type: 'text', text: 'Fix the parser.' }] },
    {
      role: 'assistant',
      content: [
        { type: 'thinking', thinking: 'Look first.' },
        { type: 'tool_use', id: 't1', name: 'Read', input: { file: 'a.ts' } },
      ],
    },
    { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't1', content: 'contents' }] },
    { role: 'user', content: [{ type: 'text', text: askText(custom, summarizer) }] },
  ];
}

export function reuseBody(custom = '', messages = reuseMessages(custom)): JsonObject {
  return {
    model: 'model-x',
    max_tokens: 100,
    system: [{ type: 'text', text: 'You are a subagent.' }],
    tools: [{ name: 'Read' }],
    thinking: { type: 'adaptive' },
    output_config: { effort: 'medium' },
    stream: true,
    messages,
  };
}

export function responsesInput(custom = ''): JsonObject[] {
  return [
    { role: 'user', content: [{ type: 'input_text', text: 'Fix the parser.' }] },
    { type: 'function_call', call_id: 'c1', name: 'Read', arguments: '{"file":"a.ts"}' },
    { type: 'function_call_output', call_id: 'c1', output: 'contents' },
    { role: 'user', content: [{ type: 'input_text', text: askText(custom) }] },
  ];
}

export function responsesBody(custom = '', input = responsesInput(custom)): JsonObject {
  return {
    model: 'gpt-x',
    instructions: 'You are Droid.',
    store: false,
    stream: true,
    tools: [{ type: 'function', name: 'Read' }],
    prompt_cache_key: 'key',
    input,
  };
}

export function stockCaptured(): JsonObject {
  return {
    model: 'model-x',
    max_tokens: 100,
    system: [{ type: 'text', text: `You are Droid. ${STOCK_SYSTEM_MARK}.` }],
    messages: [{ role: 'user', content: 'Please summarize the following conversation: ...' }],
  };
}

export function pick(value: Json | undefined, ...path: (string | number)[]): Json | undefined {
  let node = value;
  for (const key of path) {
    node =
      typeof node === 'object' && node !== null
        ? new Map(Object.entries(node)).get(String(key))
        : undefined;
  }
  return node;
}

export function textAt(value: Json | undefined, ...path: (string | number)[]): string {
  const found = pick(value, ...path);
  if (typeof found !== 'string') {
    throw new TypeError(`no text at ${path.join('.')}`);
  }
  return found;
}
