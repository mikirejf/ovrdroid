import type { CacheControl, MessagesRequest, SystemBlock, Usage } from './anthropic.ts';
import { filler as fillerOf } from './anthropic.ts';

export const SCHEDULE_NAMES = [
  'cliff',
  'refresh',
  'clock-start',
  'one-hour',
  'promote',
  'mixed',
  'price',
] as const;

export type ScheduleName = (typeof SCHEDULE_NAMES)[number];

export type SendTtl = '5m' | '1h' | 'mixed';

export interface SendStep {
  kind: 'send';
  ttl: SendTtl;
  slow: boolean;
}

export interface WaitStep {
  kind: 'wait';
  seconds: number;
}

export type Step = SendStep | WaitStep;

export interface Price {
  input: number;
  cacheRead: number;
  cacheWrite5m: number;
  cacheWrite1h: number;
}

export interface RequestSpec {
  model: string;
  promptTokens: number;
  step: SendStep;
  maxTokens: number;
  leadText?: string | undefined;
}

interface ScheduleArgs {
  minutes: readonly number[];
}

export const DEFAULT_MINUTES: readonly number[] = [3, 4, 5, 6, 8, 10, 12];
export const MAX_TOKENS_SLOW = 16_000;
export const SHORT_TTL_SECONDS = 300;
export const SECONDS_PER_MINUTE = 60;

const MAX_TOKENS_FAST = 5;
const HEAD_SHARE = 0.75;
const PER_MILLION = 1_000_000;
const FAST_PROMPT = 'Say ok.';
const SLOW_PROMPT = 'Write a numbered list of 1500 different animals, one per line, no commentary.';

export function filler(promptTokens: number): string {
  return fillerOf(
    promptTokens,
    (index) => `${index} deterministic filler line ${index} for the prompt cache probe\n`,
  );
}

function block(text: string, ttl: '5m' | '1h'): SystemBlock {
  const control: CacheControl = ttl === '1h' ? { type: 'ephemeral', ttl } : { type: 'ephemeral' };
  return { type: 'text', text, cache_control: control };
}

function systemOf(step: SendStep, promptTokens: number): SystemBlock[] {
  const text = filler(promptTokens);
  if (step.ttl !== 'mixed') {
    return [block(text, step.ttl)];
  }
  const cut = Math.floor(text.length * HEAD_SHARE);
  return [block(text.slice(0, cut), '1h'), block(text.slice(cut), '5m')];
}

export function maxTokensFor(step: SendStep): number {
  return step.slow ? MAX_TOKENS_SLOW : MAX_TOKENS_FAST;
}

export function buildRequest(spec: RequestSpec): MessagesRequest {
  const cached = systemOf(spec.step, spec.promptTokens);
  const lead: SystemBlock[] =
    spec.leadText === undefined ? [] : [{ type: 'text', text: spec.leadText }];
  return {
    model: spec.model,
    max_tokens: spec.maxTokens,
    system: [...lead, ...cached],
    messages: [{ role: 'user', content: spec.step.slow ? SLOW_PROMPT : FAST_PROMPT }],
  };
}

function send(ttl: SendTtl, slow = false): SendStep {
  return { kind: 'send', ttl, slow };
}

function wait(minutes: number): WaitStep {
  return { kind: 'wait', seconds: minutes * SECONDS_PER_MINUTE };
}

export const SCHEDULES: Record<ScheduleName, (args: ScheduleArgs) => Step[]> = {
  cliff: ({ minutes }) => [send('5m'), ...minutes.flatMap((gap) => [wait(gap), send('5m')])],
  refresh: () => [
    send('5m'),
    wait(4),
    send('5m'),
    wait(4),
    send('5m'),
    wait(4),
    send('5m'),
    wait(6),
    send('5m'),
  ],
  'clock-start': () => [send('5m', true), wait(4), send('5m')],
  'one-hour': () => [send('1h'), wait(20), send('1h')],
  promote: () => [send('5m'), wait(3), send('1h'), wait(20), send('5m')],
  mixed: () => [send('mixed'), wait(20), send('mixed')],
  price: () => [send('5m'), send('5m'), send('1h'), send('1h')],
};

export function sendSteps(steps: readonly Step[]): SendStep[] {
  return steps.filter((step) => step.kind === 'send');
}

export function wallSeconds(steps: readonly Step[]): number {
  let total = 0;
  for (const step of steps) {
    total += step.kind === 'wait' ? step.seconds : 0;
  }
  return total;
}

function writePrice(step: SendStep, promptTokens: number, price: Price): number {
  if (step.ttl === '1h') {
    return promptTokens * price.cacheWrite1h;
  }
  if (step.ttl === '5m') {
    return promptTokens * price.cacheWrite5m;
  }
  const head = promptTokens * HEAD_SHARE * price.cacheWrite1h;
  return head + promptTokens * (1 - HEAD_SHARE) * price.cacheWrite5m;
}

export function estimateCost(steps: readonly Step[], promptTokens: number, price: Price): number {
  let total = 0;
  for (const step of sendSteps(steps)) {
    total += writePrice(step, promptTokens, price) + maxTokensFor(step) * price.input;
  }
  return total / PER_MILLION;
}

export function gapLabel(seconds: number): string {
  if (seconds === 0) {
    return 'no wait';
  }
  const whole = seconds % SECONDS_PER_MINUTE === 0;
  return whole ? `${seconds / SECONDS_PER_MINUTE}m` : `${seconds}s`;
}

export interface SendLine {
  index: number;
  gapSeconds: number;
  usage: Usage;
  elapsedSeconds: number;
}

export function ttlSendLine(line: SendLine): string {
  const { index, gapSeconds, usage, elapsedSeconds } = line;
  return [
    `#${index} after ${gapLabel(gapSeconds)}: read ${usage.cacheRead}`,
    `write5m ${usage.write5m}`,
    `write1h ${usage.write1h}`,
    `took ${elapsedSeconds.toFixed(1)}s`,
  ].join(', ');
}
