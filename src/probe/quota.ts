import type { CacheTtl, MessagesRequest, SystemBlock, Usage } from './anthropic.ts';
import { CLAUDE_CODE_SYSTEM, filler } from './anthropic.ts';
import { fieldsOf, numberAt, worded } from './fields.ts';

export const ARM_NAMES = ['1h', '5m', 'read', 'plain'] as const;

export type ArmName = (typeof ARM_NAMES)[number];

export interface RequestSpec {
  model: string;
  arm: ArmName;
  text: string;
}

export interface Utilization {
  h5: number;
  h7: number;
}

export interface Crossing {
  tokens: number;
  h5: number;
}

export interface SendLine {
  index: number;
  tokens: number;
  cumulative: number;
  used: Utilization;
}

interface CrossingResult {
  crossings: number[];
  spans: number[];
  tokensPerPercent: number | undefined;
  fell: boolean;
}

const PERCENT = 100;

export const HEADER_5H = 'anthropic-ratelimit-unified-5h-utilization';
export const HEADER_7D = 'anthropic-ratelimit-unified-7d-utilization';
export const MAX_SENDS = 200;

const NONCE_BASE = 36;
const NONCE_START = 2;
const ASK = 'hi';
const MAX_TOKENS = 1;

const TTL_OF: Record<ArmName, CacheTtl | undefined> = {
  '1h': '1h',
  '5m': '5m',
  read: '1h',
  plain: undefined,
};

export function freshFiller(promptTokens: number): string {
  const nonce = `${Date.now()}-${Math.random().toString(NONCE_BASE).slice(NONCE_START)}`;
  return filler(promptTokens, (index) => `${index} quota filler line ${index} ${nonce} ${index}\n`);
}

function fillerBlock(arm: ArmName, text: string): SystemBlock {
  const ttl = TTL_OF[arm];
  if (ttl === undefined) {
    return { type: 'text', text };
  }
  return { type: 'text', text, cache_control: { type: 'ephemeral', ttl } };
}

export function buildRequest(spec: RequestSpec): MessagesRequest {
  return {
    model: spec.model,
    max_tokens: MAX_TOKENS,
    system: [{ type: 'text', text: CLAUDE_CODE_SYSTEM }, fillerBlock(spec.arm, spec.text)],
    messages: [{ role: 'user', content: ASK }],
  };
}

export function countedTokens(arm: ArmName, usage: Usage): number {
  if (arm === 'read') {
    return usage.cacheRead;
  }
  return arm === 'plain' ? usage.inputTokens : usage.cacheWrite;
}

function writeError(arm: ArmName, kind: CacheTtl, usage: Usage): string | undefined {
  const billed = kind === '1h' ? usage.write1h : usage.write5m;
  if (usage.cacheWrite === 0) {
    return `the ${arm} arm wrote nothing, so there is no write to measure`;
  }
  if (billed !== usage.cacheWrite) {
    const split = `${usage.cacheWrite} tokens written, ${billed} billed at ${kind}`;
    return `the ${arm} arm did not write at ${kind}: ${split}`;
  }
  return undefined;
}

function readError(usage: Usage): string | undefined {
  if (usage.cacheRead === 0) {
    return 'the read arm read nothing, so the primed cache was already gone';
  }
  return usage.cacheWrite === 0
    ? undefined
    : `the read arm wrote ${usage.cacheWrite} tokens, so it was not a pure read`;
}

function plainError(usage: Usage): string | undefined {
  if (usage.cacheWrite > 0) {
    return `the plain arm wrote ${usage.cacheWrite} tokens, so it was not plain input`;
  }
  return usage.cacheRead === 0
    ? undefined
    : `the plain arm read ${usage.cacheRead} cached tokens, so it was not plain input`;
}

const ARM_CHECKS: Record<ArmName, (usage: Usage) => string | undefined> = {
  '1h': (usage) => writeError('1h', '1h', usage),
  '5m': (usage) => writeError('5m', '5m', usage),
  read: readError,
  plain: plainError,
};

export function checkArm(arm: ArmName, usage: Usage): string | undefined {
  return ARM_CHECKS[arm](usage);
}

function rate(get: (name: string) => string | null, name: string): number {
  const raw = get(name);
  const value = raw === null || raw === '' ? Number.NaN : Number(raw);
  if (Number.isFinite(value)) {
    return value;
  }
  throw new Error(`the response carried no ${name} header`);
}

export function parseUtilization(get: (name: string) => string | null): Utilization {
  return { h5: rate(get, HEADER_5H), h7: rate(get, HEADER_7D) };
}

export function crossings(records: readonly Crossing[]): CrossingResult {
  const found: number[] = [];
  const spans: number[] = [];
  let cumulative = 0;
  let last = records.at(0)?.h5;
  let fell = false;

  for (const entry of records) {
    cumulative += entry.tokens;
    if (last === undefined) {
      continue;
    }
    if (entry.h5 < last) {
      fell = true;
    }
    if (entry.h5 > last) {
      const percents = Math.round((entry.h5 - last) * PERCENT);
      const since = found.at(-1);
      if (since !== undefined) {
        spans.push((cumulative - since) / percents);
      }
      found.push(cumulative);
      last = entry.h5;
    }
  }

  const total = spans.reduce((sum, span) => sum + span, 0);
  return {
    crossings: found,
    spans,
    tokensPerPercent: spans.length === 0 ? undefined : total / spans.length,
    fell,
  };
}

function crossingWord(seen: number): string {
  return seen === 1 ? '1 crossing' : `${seen} crossings`;
}

export function verdict(arm: ArmName, model: string, result: CrossingResult): string {
  const head = `ARM ${arm} ${model}: ${crossingWord(result.crossings.length)}`;
  if (result.tokensPerPercent === undefined) {
    return `${head}; the run stopped before a span could be measured`;
  }
  const spans = result.spans.map((span) => Math.round(span)).join(', ');
  const mean = Math.round(result.tokensPerPercent);
  const line = `${head}; tokens per 1% of the 5h quota: ${spans}; mean ${mean}`;
  return result.fell
    ? `${line}; the meter fell during the run, so older usage aged out and the spans read high`
    : line;
}

export function quotaSendLine(line: SendLine): string {
  const { index, tokens, cumulative, used } = line;
  return `#${index} tokens=${tokens} cum=${cumulative} 5h=${used.h5} 7d=${used.h7}`;
}

export interface RunRecord {
  t: string;
  arm: ArmName;
  model: string;
  tokens: number;
  h5: number;
}

export interface MeasuredRate {
  tokensPerPercent: number;
  model: string;
  arm: ArmName;
  sends: number;
  at: string;
}

export function parseRunRecord(raw: unknown): RunRecord | undefined {
  const fields = fieldsOf(raw);
  const arm = ARM_NAMES.find((name) => name === fields.get('arm'));
  const tokens = numberAt(fields, 'tokens');
  const h5 = numberAt(fields, 'h5');
  const model = worded(fields, 'model');
  if (arm === undefined || tokens === undefined || h5 === undefined || model === '') {
    return undefined;
  }
  return { t: worded(fields, 't'), arm, model, tokens, h5 };
}

export function parseRuns(body: string): RunRecord[] {
  const records: RunRecord[] = [];
  for (const line of body.split('\n')) {
    if (line.trim() === '') {
      continue;
    }
    try {
      const record = parseRunRecord(JSON.parse(line));
      if (record !== undefined) {
        records.push(record);
      }
    } catch {
      continue;
    }
  }
  return records;
}

function groupKey(record: RunRecord): string {
  return `${record.model}\u0000${record.arm}`;
}

export function measuredRate(
  records: readonly RunRecord[],
  matches: (model: string) => boolean,
): MeasuredRate | undefined {
  const groups = new Map<string, RunRecord[]>();
  for (const record of records) {
    if (record.arm !== '1h' && record.arm !== '5m') {
      continue;
    }
    if (!matches(record.model)) {
      continue;
    }
    const key = groupKey(record);
    const found = groups.get(key);
    if (found === undefined) {
      groups.set(key, [record]);
    } else {
      found.push(record);
    }
  }

  let best: MeasuredRate | undefined;
  for (const group of groups.values()) {
    const result = crossings(group);
    const first = group.at(0);
    if (result.tokensPerPercent === undefined || first === undefined) {
      continue;
    }
    if (best === undefined || group.length > best.sends) {
      best = {
        tokensPerPercent: result.tokensPerPercent,
        model: first.model,
        arm: first.arm,
        sends: group.length,
        at: group.at(-1)?.t ?? first.t,
      };
    }
  }
  return best;
}
