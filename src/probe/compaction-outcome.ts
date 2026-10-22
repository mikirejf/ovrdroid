import { declines, isSummaryReply } from '../patch/summary-format.ts';
import { fieldsOf, worded } from './fields.ts';

export type Outcome = 'summary' | 'refusal' | 'own-layout' | 'error';

export interface ReplyReading {
  outcome: Outcome;
  text: string;
  tools: readonly string[];
}

export const MIN_LAYOUT_CHARS = 300;

export function classifyText(text: string, tools: readonly string[]): Outcome {
  if (tools.length > 0) {
    return 'refusal';
  }
  if (isSummaryReply(text)) {
    return 'summary';
  }
  const real = text.trim().length >= MIN_LAYOUT_CHARS && !declines(text);
  return real ? 'own-layout' : 'refusal';
}

export function readReply(content: readonly unknown[]): ReplyReading {
  const blocks = content.map((block) => fieldsOf(block));
  const text = blocks
    .filter((fields) => worded(fields, 'type') === 'text')
    .map((fields) => worded(fields, 'text'))
    .join('\n');
  const tools = blocks
    .filter((fields) => worded(fields, 'type') === 'tool_use')
    .map((fields) => worded(fields, 'name'));
  return { outcome: classifyText(text, tools), text, tools };
}
