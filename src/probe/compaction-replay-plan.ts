import type { BodyRow, JsonObject } from './bodies.ts';
import { parseBodies } from './bodies.ts';
import {
  compactionKind,
  INLINE_TOOLS_BETA,
  noClaimBody,
  noMentionBody,
  stockBody,
  systemBody,
} from './compaction-replay-bodies.ts';

export const ARMS = ['reuse', 'no-mention', 'no-claim', 'system', 'stock'] as const;

export type Arm = (typeof ARMS)[number] | 'stock-captured';

export interface IndexedRow {
  index: number;
  row: BodyRow;
}

export interface Slot {
  row: number;
  arm: Arm;
  run: number;
  warm: boolean;
}

export interface ReplayJob extends Slot {
  body: JsonObject;
  headers: Record<string, string>;
}

export interface PlanOptions {
  rows?: readonly number[] | undefined;
  runs: number;
  arms?: readonly Arm[] | undefined;
}

export interface ReplayPlan {
  warmups: ReplayJob[];
  jobs: ReplayJob[];
}

interface Variant {
  build: (body: JsonObject) => JsonObject;
  headers: Record<string, string>;
}

const VARIANTS: Record<(typeof ARMS)[number], Variant> = {
  reuse: { build: (body) => body, headers: {} },
  'no-mention': { build: noMentionBody, headers: {} },
  'no-claim': { build: noClaimBody, headers: {} },
  system: { build: systemBody, headers: { 'anthropic-beta': INLINE_TOOLS_BETA } },
  stock: { build: stockBody, headers: {} },
};

export function isArm(value: string): value is Arm {
  return value === 'stock-captured' || ARMS.some((arm) => arm === value);
}

export function compactionRows(text: string): IndexedRow[] {
  const lines = text.split('\n');
  const last = lines.findLastIndex((line) => line.trim() !== '');
  return lines.flatMap((line, index) => {
    if (line.trim() === '') {
      return [];
    }
    try {
      return parseBodies(line).map((row) => ({ index, row }));
    } catch (error) {
      if (index === last) {
        return [];
      }
      throw error;
    }
  });
}

function pickRows(
  rows: readonly IndexedRow[],
  wanted: readonly number[] | undefined,
): IndexedRow[] {
  if (wanted === undefined) {
    return rows.filter((entry) => compactionKind(entry.row.body) !== undefined);
  }
  const byIndex = new Map(rows.map((entry) => [entry.index, entry]));
  return wanted.map((index) => {
    const found = byIndex.get(index);
    if (found === undefined || compactionKind(found.row.body) === undefined) {
      throw new Error(`row ${index} is not a compaction request`);
    }
    return found;
  });
}

function jobOf(slot: Slot, body: JsonObject, headers: Record<string, string>): ReplayJob {
  return { ...slot, body: { ...body, stream: false }, headers };
}

function armsOf(entry: IndexedRow, wanted: readonly Arm[]): Arm[] {
  return compactionKind(entry.row.body) === 'stock' ? ['stock-captured'] : [...wanted];
}

function rotated<T>(items: readonly T[], by: number): T[] {
  const at = items.length === 0 ? 0 : by % items.length;
  return [...items.slice(at), ...items.slice(0, at)];
}

function variantJob(entry: IndexedRow, arm: Arm, run: number): ReplayJob {
  const slot = { row: entry.index, arm, run, warm: false };
  const { body } = entry.row;
  if (arm === 'stock-captured') {
    return jobOf(slot, body, {});
  }
  const variant = VARIANTS[arm];
  return jobOf(slot, variant.build(body), variant.headers);
}

export function planJobs(rows: readonly IndexedRow[], options: PlanOptions): ReplayPlan {
  const picked = pickRows(rows, options.rows);
  if (picked.length === 0) {
    throw new Error('the file holds no compaction request');
  }
  const wanted = options.arms ?? ARMS;
  const warmups = picked.map((entry) => {
    const arm = compactionKind(entry.row.body) === 'stock' ? 'stock-captured' : 'reuse';
    return jobOf({ row: entry.index, arm, run: 0, warm: true }, entry.row.body, {});
  });
  const jobs = Array.from({ length: options.runs }, (_unused, at) => at + 1).flatMap((run) =>
    picked.flatMap((entry, position) =>
      rotated(armsOf(entry, wanted), run - 1 + position).map((arm) => variantJob(entry, arm, run)),
    ),
  );
  return { warmups, jobs };
}
