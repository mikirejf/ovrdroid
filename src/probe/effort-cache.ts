import { whole } from '../cli.ts';
import type { Message, MessagesRequest, RequestHeaders, SystemBlock, Usage } from './anthropic.ts';
import { filler as fillerOf } from './anthropic.ts';
import { fieldsOf, worded } from './fields.ts';

export const SEED_EFFORT = 'high';
export const SWITCHED_EFFORT = 'medium';
export const MID_CONVERSATION_BETA = 'mid-conversation-output-config-2026-07-01';

const MAX_TOKENS = 4000;
const SYSTEM_TEXT = 'You are a careful math agent. Use private reasoning, then answer briefly.';
const CONTEXT_INTRO = 'Treat the following list as irrelevant cached context:\n';
const QUESTION =
  '\nNow solve this without tools: find the least positive integer n such that 2^n ends in 000001 in base 10. Give n and one short verification.';
const FOLLOW_UP = 'Check the result once more and reply with only the integer.';

export type SendName = 'seed' | 'same effort' | 'top-level switch' | 'system-message switch';

export interface Send {
  name: SendName;
  effort: string;
  messageEffort?: string;
}

export const SEED: Send = { name: 'seed', effort: SEED_EFFORT };
export const SAME_EFFORT: Send = { name: 'same effort', effort: SEED_EFFORT };
export const TOP_LEVEL_SWITCH: Send = { name: 'top-level switch', effort: SWITCHED_EFFORT };
export const SYSTEM_MESSAGE_SWITCH: Send = {
  name: 'system-message switch',
  effort: SEED_EFFORT,
  messageEffort: SWITCHED_EFFORT,
};
export const SENDS: readonly Send[] = [SEED, SAME_EFFORT, TOP_LEVEL_SWITCH, SYSTEM_MESSAGE_SWITCH];

export interface RequestSpec {
  model: string;
  messages: readonly Message[];
  send: Send;
  leadText?: string | undefined;
}

function filler(promptTokens: number): string {
  return fillerOf(
    promptTokens,
    (index) => `${index} deterministic filler line ${index} for the effort cache probe\n`,
  );
}

export function seedMessages(promptTokens: number, runId: string): Message[] {
  const text = `run ${runId}\n${CONTEXT_INTRO}${filler(promptTokens)}${QUESTION}`;
  return [
    {
      role: 'user',
      content: [{ type: 'text', text, cache_control: { type: 'ephemeral', ttl: '1h' } }],
    },
  ];
}

export function historyOf(seed: readonly Message[], reply: readonly unknown[]): Message[] {
  return [...seed, { role: 'assistant', content: reply }, { role: 'user', content: FOLLOW_UP }];
}

function withMessageEffort(messages: readonly Message[], effort: string | undefined): Message[] {
  if (effort === undefined) {
    return [...messages];
  }
  const effortOnly: Message = { role: 'system', content: [], output_config: { effort } };
  return [...messages.slice(0, -1), effortOnly, ...messages.slice(-1)];
}

export function buildRequest(spec: RequestSpec): MessagesRequest {
  const lead: SystemBlock[] =
    spec.leadText === undefined ? [] : [{ type: 'text', text: spec.leadText }];
  return {
    model: spec.model,
    max_tokens: MAX_TOKENS,
    system: [...lead, { type: 'text', text: SYSTEM_TEXT }],
    messages: withMessageEffort(spec.messages, spec.send.messageEffort),
    thinking: { type: 'adaptive' },
    output_config: { effort: spec.send.effort },
  };
}

export function headersFor(send: Send, base: RequestHeaders): RequestHeaders {
  if (send.messageEffort === undefined) {
    return base;
  }
  const existing = base['anthropic-beta'];
  const beta =
    existing === undefined ? MID_CONVERSATION_BETA : `${existing},${MID_CONVERSATION_BETA}`;
  return { ...base, 'anthropic-beta': beta };
}

export function hasSignedThinking(content: readonly unknown[]): boolean {
  return content.some((part) => {
    const fields = fieldsOf(part);
    return worded(fields, 'type') === 'thinking' && worded(fields, 'signature') !== '';
  });
}

export function sendLine(name: SendName, usage: Usage, elapsedSeconds: number): string {
  return `${name}: read ${whole(usage.cacheRead)}, wrote ${whole(usage.cacheWrite)}, took ${elapsedSeconds.toFixed(1)}s`;
}
