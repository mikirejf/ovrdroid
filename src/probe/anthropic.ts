import type { Fields } from './fields.ts';
import { counted, fieldsOf } from './fields.ts';

export const CLAUDE_ENDPOINT = 'https://api.anthropic.com/v1/messages';
export const CLAUDE_USER_AGENT = 'claude-cli/2.1.260';
export const CLAUDE_CODE_SYSTEM = "You are Claude Code, Anthropic's official CLI for Claude.";
export const ANTHROPIC_VERSION = '2023-06-01';

const CHARS_PER_TOKEN = 3.5;

export type CacheTtl = '5m' | '1h';

export interface CacheControl {
  type: 'ephemeral';
  ttl?: CacheTtl;
}

export interface SystemBlock {
  type: 'text';
  text: string;
  cache_control?: CacheControl;
}

export interface UserMessage {
  role: 'user';
  content: string;
}

export interface MessagesRequest {
  model: string;
  max_tokens: number;
  system: SystemBlock[];
  messages: UserMessage[];
}

export interface Usage {
  inputTokens: number;
  cacheRead: number;
  cacheWrite: number;
  write5m: number;
  write1h: number;
  outputTokens: number;
}

export function parseUsage(raw: unknown): Usage | undefined {
  const fields: Fields = fieldsOf(raw);
  if (typeof fields.get('input_tokens') !== 'number') {
    return undefined;
  }
  const split = fieldsOf(fields.get('cache_creation'));
  return {
    inputTokens: counted(fields, 'input_tokens'),
    cacheRead: counted(fields, 'cache_read_input_tokens'),
    cacheWrite: counted(fields, 'cache_creation_input_tokens'),
    write5m: counted(split, 'ephemeral_5m_input_tokens'),
    write1h: counted(split, 'ephemeral_1h_input_tokens'),
    outputTokens: counted(fields, 'output_tokens'),
  };
}

export function filler(promptTokens: number, lineFor: (index: number) => string): string {
  const wanted = Math.round(promptTokens * CHARS_PER_TOKEN);
  const lines: string[] = [];
  let length = 0;
  for (let index = 1; length < wanted; index += 1) {
    const line = lineFor(index);
    lines.push(line);
    length += line.length;
  }
  return lines.join('').slice(0, wanted);
}

export type RequestHeaders = Record<string, string>;

export function oauthHeaders(token: string) {
  return {
    authorization: `Bearer ${token}`,
    'anthropic-beta': 'oauth-2025-04-20',
    'anthropic-version': ANTHROPIC_VERSION,
    'user-agent': CLAUDE_USER_AGENT,
    'content-type': 'application/json',
    accept: 'application/json',
  } satisfies RequestHeaders;
}

export function apiKeyHeaders(apiKey: string) {
  return {
    'x-api-key': apiKey,
    'anthropic-version': ANTHROPIC_VERSION,
    'content-type': 'application/json',
  } satisfies RequestHeaders;
}
