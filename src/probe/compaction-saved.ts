import path from 'node:path';

import type { Usage } from './anthropic.ts';
import type { Arm, Slot } from './compaction-replay-plan.ts';
import { isArm } from './compaction-replay-plan.ts';
import type { Fields } from './fields.ts';
import { counted, fieldsOf, hasNumbers, numberAt, worded } from './fields.ts';

export interface SavedReply extends Slot {
  model: string;
  latencyMs: number;
  content: readonly unknown[];
  stopReason: string;
  usage: Usage | undefined;
  error: string | undefined;
}

const JSON_INDENT = 2;
const SAVED_FILES = 'row-*.json';
const USAGE_FIELDS = [
  'inputTokens',
  'cacheRead',
  'cacheWrite',
  'write5m',
  'write1h',
  'outputTokens',
];

export function savedName(slot: Slot): string {
  return slot.warm ? `row-${slot.row}-warm.json` : `row-${slot.row}-${slot.arm}-${slot.run}.json`;
}

export function savedJson(reply: SavedReply): string {
  return JSON.stringify(
    {
      row: reply.row,
      arm: reply.arm,
      run: reply.run,
      warm: reply.warm,
      model: reply.model,
      latencyMs: reply.latencyMs,
      stop_reason: reply.stopReason,
      usage: reply.usage ?? null,
      error: reply.error ?? null,
      content: reply.content,
    },
    null,
    JSON_INDENT,
  );
}

function armOf(raw: string): Arm {
  if (!isArm(raw)) {
    throw new Error(`unknown arm "${raw}"`);
  }
  return raw;
}

function usageOf(fields: Fields): Usage | undefined {
  const usage = fieldsOf(fields.get('usage'));
  if (!hasNumbers(usage, USAGE_FIELDS)) {
    return undefined;
  }
  return {
    inputTokens: counted(usage, 'inputTokens'),
    cacheRead: counted(usage, 'cacheRead'),
    cacheWrite: counted(usage, 'cacheWrite'),
    write5m: counted(usage, 'write5m'),
    write1h: counted(usage, 'write1h'),
    outputTokens: counted(usage, 'outputTokens'),
  };
}

export function parseSaved(value: unknown): SavedReply {
  const fields = fieldsOf(value);
  const row = numberAt(fields, 'row');
  const run = numberAt(fields, 'run');
  const content = fields.get('content');
  if (row === undefined || run === undefined || !Array.isArray(content)) {
    throw new TypeError('not a saved compaction reply: row, run or content is missing');
  }
  const error = worded(fields, 'error');
  return {
    row,
    arm: armOf(worded(fields, 'arm')),
    run,
    warm: fields.get('warm') === true,
    model: worded(fields, 'model'),
    latencyMs: counted(fields, 'latencyMs'),
    content,
    stopReason: worded(fields, 'stop_reason'),
    usage: usageOf(fields),
    error: error === '' ? undefined : error,
  };
}

export async function readSaved(dir: string): Promise<SavedReply[]> {
  const files = await Array.fromAsync(new Bun.Glob(SAVED_FILES).scan({ cwd: dir, absolute: true }));
  const replies = await Promise.all(
    files.toSorted().map(async (file) => {
      try {
        return parseSaved(await Bun.file(file).json());
      } catch (error) {
        const why = error instanceof Error ? error.message : String(error);
        throw new Error(`${path.basename(file)}: ${why}`, { cause: error });
      }
    }),
  );
  if (replies.length === 0) {
    throw new Error(`${dir} holds no saved replies (row-*.json)`);
  }
  return replies;
}
