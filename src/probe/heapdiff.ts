import { KIB, kilobytes, megabytes, whole } from '../cli.ts';
import type { Summary, Tally } from './heapsnapshot.ts';

const SHOWN_CHARS = 120;
const SIZE_COLUMN = 11;
const COUNT_COLUMN = 9;
const KEY_COLUMN = 44;

export interface Growth {
  key: string;
  countBefore: number;
  countAfter: number;
  sizeDelta: number;
}

export interface NewString {
  content: string;
  count: number;
  size: number;
}

export function growthOf(
  before: ReadonlyMap<string, Tally>,
  after: ReadonlyMap<string, Tally>,
  limit: number,
): Growth[] {
  const growth: Growth[] = [];
  for (const [key, now] of after) {
    const was = before.get(key) ?? { count: 0, size: 0 };
    if (now.size > was.size) {
      growth.push({
        key,
        countBefore: was.count,
        countAfter: now.count,
        sizeDelta: now.size - was.size,
      });
    }
  }
  return growth.toSorted((a, b) => b.sizeDelta - a.sizeDelta).slice(0, limit);
}

export function newStrings(before: Summary, after: Summary, limit: number): NewString[] {
  const fresh: NewString[] = [];
  for (const [content, tally] of after.strings) {
    if (!before.strings.has(content)) {
      fresh.push({ content, count: tally.count, size: tally.size });
    }
  }
  return fresh.toSorted((a, b) => b.size - a.size).slice(0, limit);
}

function sizeText(bytes: number): string {
  return bytes >= KIB * KIB ? megabytes(bytes / KIB) : kilobytes(bytes);
}

function signedSize(bytes: number): string {
  return `${bytes < 0 ? '-' : '+'}${sizeText(Math.abs(bytes))}`;
}

function signedCount(delta: number): string {
  return `${delta < 0 ? '-' : '+'}${whole(Math.abs(delta))}`;
}

export function shown(text: string, limit = SHOWN_CHARS): string {
  const flat = JSON.stringify(text).slice(1, -1);
  return flat.length > limit ? `${flat.slice(0, limit)}...` : flat;
}

export function formatTotals(before: Summary, after: Summary): string {
  return [
    `  nodes      ${whole(before.nodes)} -> ${whole(after.nodes)}  (${signedCount(after.nodes - before.nodes)})`,
    `  self size  ${sizeText(before.size)} -> ${sizeText(after.size)}  (${signedSize(after.size - before.size)})`,
  ].join('\n');
}

export function formatGrowth(growth: readonly Growth[], keyWidth = KEY_COLUMN): string {
  if (growth.length === 0) {
    return '  nothing grew';
  }
  return growth
    .map(
      (entry) =>
        `  ${signedSize(entry.sizeDelta).padStart(SIZE_COLUMN)}  ${signedCount(entry.countAfter - entry.countBefore).padStart(COUNT_COLUMN)}  ${shown(entry.key, keyWidth).padEnd(keyWidth)}  (${whole(entry.countBefore)} -> ${whole(entry.countAfter)})`,
    )
    .join('\n');
}

export function formatNewStrings(fresh: readonly NewString[]): string {
  if (fresh.length === 0) {
    return '  no string exists only after';
  }
  return fresh
    .map(
      (entry) =>
        `  ${sizeText(entry.size).padStart(SIZE_COLUMN)}  x${whole(entry.count).padEnd(COUNT_COLUMN)}  "${shown(entry.content)}"`,
    )
    .join('\n');
}
