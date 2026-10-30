import { fieldsOf, hasNumbers, parseJsonLines } from './fields.ts';
import type { ModelPrice } from './prices.ts';
import { costOf } from './prices.ts';
import type { RunUsage } from './task-ab-run.ts';
import { emptyCounts } from './task-ab-transcript.ts';
import type { TranscriptCounts } from './task-ab-transcript.ts';

export interface RunRow extends TranscriptCounts {
  rep: number;
  task: string;
  model: string;
  arm: string;
  seconds: number;
  correct: boolean;
  reason: string;
  error: string | null;
  sessionId: string;
  usage: RunUsage;
  costUsd: number | null;
}

const USAGE_KEYS = ['input', 'cacheRead', 'cacheWrite', 'output'];
const NUMBER_KEYS = ['rep', 'seconds', ...Object.keys(emptyCounts())];
const STRING_KEYS = ['task', 'model', 'arm', 'reason', 'sessionId'];

export function usageCost(price: ModelPrice, usage: RunUsage): number {
  const hourly = price.cacheWrite1h !== undefined;
  return costOf(price, {
    inputTokens: usage.input,
    outputTokens: usage.output,
    cacheReadTokens: usage.cacheRead,
    cacheWrite5mTokens: hourly ? 0 : usage.cacheWrite,
    cacheWrite1hTokens: hourly ? usage.cacheWrite : 0,
  });
}

function isRow(value: unknown): value is RunRow {
  const fields = fieldsOf(value);
  const error = fields.get('error');
  return (
    hasNumbers(fields, NUMBER_KEYS) &&
    (fields.get('costUsd') === null || typeof fields.get('costUsd') === 'number') &&
    STRING_KEYS.every((key) => typeof fields.get(key) === 'string') &&
    typeof fields.get('correct') === 'boolean' &&
    (error === null || typeof error === 'string') &&
    hasNumbers(fieldsOf(fields.get('usage')), USAGE_KEYS)
  );
}

export function parseRows(text: string): RunRow[] {
  return parseJsonLines(text, isRow);
}
