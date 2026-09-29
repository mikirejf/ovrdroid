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
  'unrelated',
  'shared-head',
  'hour-refresh',
  'hour-cliff',
] as const;

export type ScheduleName = (typeof SCHEDULE_NAMES)[number];

export type SendTtl = '5m' | '1h' | 'mixed' | 'split';

type BlockTtl = '5m' | '1h';

interface BlockLayout {
  share: number;
  ttl: BlockTtl;
}

export const BLOCK_LAYOUTS: Record<SendTtl, readonly BlockLayout[]> = {
  '5m': [{ share: 1, ttl: '5m' }],
  '1h': [{ share: 1, ttl: '1h' }],
  mixed: [
    { share: 0.75, ttl: '1h' },
    { share: 0.25, ttl: '5m' },
  ],
  split: [
    { share: 0.25, ttl: '5m' },
    { share: 0.75, ttl: '5m' },
  ],
};

export interface SendStep {
  kind: 'send';
  ttl: SendTtl;
  slow: boolean;
  other: boolean;
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
  runId: string;
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
const PER_MILLION = 1_000_000;
const FAST_PROMPT = 'Say ok.';
const SLOW_PROMPT = 'Write a numbered list of 1500 different animals, one per line, no commentary.';

export function filler(promptTokens: number): string {
  return fillerOf(
    promptTokens,
    (index) => `${index} deterministic filler line ${index} for the prompt cache probe\n`,
  );
}

export function otherFiller(promptTokens: number): string {
  return fillerOf(
    promptTokens,
    (index) => `${index} another conversation entirely, turn ${index}, nothing shared\n`,
  );
}

function block(text: string, ttl: BlockTtl): SystemBlock {
  const control: CacheControl = ttl === '1h' ? { type: 'ephemeral', ttl } : { type: 'ephemeral' };
  return { type: 'text', text, cache_control: control };
}

function systemOf(step: SendStep, promptTokens: number, runId: string): SystemBlock[] {
  const run = `run ${runId}\n`;
  const main = `${run}${filler(promptTokens)}`;
  const body = step.other ? `${run}${otherFiller(promptTokens)}` : main;
  const layout = BLOCK_LAYOUTS[step.ttl];
  let covered = 0;
  let start = 0;
  return layout.map(({ share, ttl }, index) => {
    covered += share;
    const isLast = index === layout.length - 1;
    const end = isLast ? undefined : Math.floor(main.length * covered);
    const source = index === 0 && layout.length > 1 ? main : body;
    const text = source.slice(start, end);
    start = end ?? start;
    return block(text, ttl);
  });
}

export function maxTokensFor(step: SendStep): number {
  return step.slow ? MAX_TOKENS_SLOW : MAX_TOKENS_FAST;
}

export function buildRequest(spec: RequestSpec): MessagesRequest {
  const cached = systemOf(spec.step, spec.promptTokens, spec.runId);
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
  return { kind: 'send', ttl, slow, other: false };
}

function sendOther(ttl: SendTtl): SendStep {
  return { kind: 'send', ttl, slow: false, other: true };
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
  unrelated: () => [send('5m'), wait(4), sendOther('5m'), wait(2), send('5m')],
  'shared-head': () => [send('split'), wait(4), sendOther('split'), wait(2), send('split')],
  'hour-refresh': () => [send('1h'), wait(54), send('1h'), wait(54), send('1h')],
  'hour-cliff': () => [send('1h'), wait(66), send('1h')],
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
  return BLOCK_LAYOUTS[step.ttl].reduce(
    (total, { share, ttl }) =>
      total + promptTokens * share * (ttl === '1h' ? price.cacheWrite1h : price.cacheWrite5m),
    0,
  );
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
