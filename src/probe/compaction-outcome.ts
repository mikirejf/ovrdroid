import { isSummary } from '../patch/summary-format.ts';
import { fieldsOf, worded } from './fields.ts';

export type Outcome = 'summary' | 'refusal' | 'own-layout' | 'error';

export interface ReplyReading {
  outcome: Outcome;
  text: string;
  tools: readonly string[];
}

export const OPENING_CHARS = 240;
export const MIN_LAYOUT_CHARS = 300;

const DECLINE_WORD =
  /\b(?:won['’]t|will not|not going to|can['’]t|cannot|rather than|skip(?:ping)?|declin\w*|refus\w*)\b/iu;
const SUMMARY_WORD = /\b(?:summar\w*|recap|template)\b/iu;
const KEEP_GOING = /\bkeep (?:going|working)\b/iu;

function opening(text: string): string {
  return text.trim().slice(0, OPENING_CHARS);
}

export function declines(text: string): boolean {
  const start = opening(text);
  return (DECLINE_WORD.test(start) && SUMMARY_WORD.test(start)) || KEEP_GOING.test(start);
}

export function classifyText(text: string, tools: readonly string[]): Outcome {
  if (tools.length > 0) {
    return 'refusal';
  }
  if (isSummary(text)) {
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
