import { WARM_MESSAGE_ID_PREFIX } from '../patch/warmer-patches.ts';
import { percent } from './cachekey.ts';

export type Json = string | number | boolean | null | readonly Json[] | JsonObject;
export interface JsonObject {
  readonly [key: string]: Json;
}

export interface BodyRow {
  t: number;
  sessionId: string;
  assistantMessageId: string;
  route: string;
  transport: string;
  body: JsonObject;
}

type PathPart = string | number;

interface Span {
  start: number;
  end: number;
  path: readonly PathPart[];
}

interface Serialised {
  text: string;
  spans: readonly Span[];
}

interface PromptText {
  prompt: JsonObject;
  text: string;
  head: string;
}

export interface Divergence {
  offset: number;
  path: readonly PathPart[];
  label: string;
  share: number;
  old: string;
  new: string;
}

export interface Pairing {
  sessionId: string;
  newName: string;
  oldName: string;
  oldChars: number;
  newChars: number;
  chained: boolean;
  divergence: Divergence | undefined;
  settings: readonly string[];
}

const CACHE_ORDER = ['instructions', 'tools', 'system', 'input', 'messages'];
const PROMPT_KEYS = new Set(CACHE_ORDER);
const EXCERPT = 40;
const REMINDER = '<system-reminder>';

function toJson(value: unknown): Json {
  if (Array.isArray(value)) {
    const items: readonly unknown[] = value;
    return items.map((item) => toJson(item));
  }
  if (typeof value === 'object' && value !== null) {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, toJson(item)]));
  }
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return value;
  }
  return null;
}

function isList(value: Json | undefined): value is readonly Json[] {
  return Array.isArray(value);
}

function isRecord(value: Json | undefined): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function stringOr(value: Json | undefined, fallback: string): string {
  return typeof value === 'string' ? value : fallback;
}

function parseRow(line: string): BodyRow | undefined {
  const value = toJson(JSON.parse(line));
  if (!isRecord(value) || !isRecord(value['body'])) {
    return undefined;
  }
  return {
    t: typeof value['t'] === 'number' ? value['t'] : 0,
    sessionId: stringOr(value['sessionId'], ''),
    assistantMessageId: stringOr(value['assistantMessageId'], ''),
    route: stringOr(value['route'], ''),
    transport: stringOr(value['transport'], 'http'),
    body: value['body'],
  };
}

export function parseBodies(text: string): BodyRow[] {
  return text
    .split('\n')
    .filter((line) => line.trim() !== '')
    .map((line) => parseRow(line))
    .filter((row) => row !== undefined);
}

export function isWarm(row: BodyRow): boolean {
  return row.assistantMessageId.startsWith(WARM_MESSAGE_ID_PREFIX);
}

function promptOf(body: JsonObject): JsonObject {
  return Object.fromEntries(
    CACHE_ORDER.filter((key) => key in body).map((key) => [key, body[key] ?? null]),
  );
}

function settingsOf(body: JsonObject): JsonObject {
  return Object.fromEntries(Object.entries(body).filter(([key]) => !PROMPT_KEYS.has(key)));
}

function serialise(value: Json): Serialised {
  let text = '';
  const spans: Span[] = [];
  const write = (node: Json, path: readonly PathPart[]): void => {
    const start = text.length;
    if (isList(node)) {
      text += '[';
      for (const [index, item] of node.entries()) {
        text += index > 0 ? ',' : '';
        write(item, [...path, index]);
      }
      text += ']';
    } else if (isRecord(node)) {
      text += '{';
      for (const [index, [key, item]] of Object.entries(node).entries()) {
        text += `${index > 0 ? ',' : ''}${JSON.stringify(key)}:`;
        write(item, [...path, key]);
      }
      text += '}';
    } else {
      text += JSON.stringify(node);
    }
    spans.push({ start, end: text.length, path });
  };
  write(value, []);
  return { text, spans };
}

function open(text: string): string {
  return text.replace(/[\]}]+$/u, '');
}

function commonLength(a: string, b: string): number {
  const limit = Math.min(a.length, b.length);
  let index = 0;
  while (index < limit && a[index] === b[index]) {
    index += 1;
  }
  return index;
}

function deepestAt(spans: readonly Span[], offset: number): Span | undefined {
  let best: Span | undefined;
  for (const span of spans) {
    if (
      span.start <= offset &&
      offset < span.end &&
      (best === undefined || span.path.length > best.path.length)
    ) {
      best = span;
    }
  }
  return best;
}

export function pathText(path: readonly PathPart[]): string {
  return path
    .map((part, index) =>
      typeof part === 'number' ? `[${part}]` : `${index > 0 ? '.' : ''}${part}`,
    )
    .join('');
}

function textOf(item: Json): string {
  if (typeof item === 'string') {
    return item;
  }
  if (isList(item)) {
    return item.map((part) => textOf(part)).join('');
  }
  if (isRecord(item)) {
    return textOf(item['text'] ?? item['content'] ?? '');
  }
  return '';
}

function describeItem(root: JsonObject, key: string, index: number): string {
  const list = root[key];
  const item = isList(list) ? list[index] : undefined;
  if (!isRecord(item)) {
    return '';
  }
  if (key === 'tools') {
    const name = item['name'] ?? item['type'];
    return typeof name === 'string' ? `tool ${name}` : 'a tool';
  }
  if (textOf(item).trimStart().startsWith(REMINDER)) {
    return 'the reminder block';
  }
  const kind = item['role'] ?? item['type'];
  return typeof kind === 'string' ? `${kind} item` : '';
}

function labelOf(root: JsonObject, path: readonly PathPart[]): string {
  const [key, index] = path;
  if (typeof key !== 'string') {
    return 'the prompt';
  }
  if (typeof index !== 'number') {
    return key;
  }
  const about = describeItem(root, key, index);
  return about === '' ? `${key}[${index}]` : `${key}[${index}] (${about})`;
}

function excerpt(text: string, offset: number): string {
  const from = Math.max(0, offset - EXCERPT);
  const to = Math.min(text.length, offset + EXCERPT);
  return `${from > 0 ? '…' : ''}${text.slice(from, to)}${to < text.length ? '…' : ''}`;
}

const promptCache = new WeakMap<JsonObject, PromptText>();

function promptText(body: JsonObject): PromptText {
  let cached = promptCache.get(body);
  if (cached === undefined) {
    const prompt = promptOf(body);
    const text = JSON.stringify(prompt);
    cached = { prompt, text, head: open(text) };
    promptCache.set(body, cached);
  }
  return cached;
}

export function divergence(oldBody: JsonObject, newBody: JsonObject): Divergence | undefined {
  const before = promptText(oldBody);
  const after = promptText(newBody);
  if (after.text.startsWith(before.head)) {
    return undefined;
  }
  const offset = commonLength(before.head, after.text);
  const inOld = deepestAt(serialise(before.prompt).spans, offset);
  const path = inOld?.path ?? deepestAt(serialise(after.prompt).spans, offset)?.path ?? [];
  return {
    offset,
    path,
    label: labelOf(inOld === undefined ? after.prompt : before.prompt, path),
    share: before.head.length === 0 ? 0 : offset / before.head.length,
    old: excerpt(before.text, offset),
    new: excerpt(after.text, offset),
  };
}

export function settingsDiffer(oldBody: JsonObject, newBody: JsonObject): string[] {
  const before = settingsOf(oldBody);
  const after = settingsOf(newBody);
  const keys = [...new Set([...Object.keys(before), ...Object.keys(after)])];
  return keys.filter((key) => JSON.stringify(before[key]) !== JSON.stringify(after[key]));
}

interface Named {
  name: string;
  row: BodyRow;
}

function compare(older: Named, newer: Named): Pairing {
  const { row: oldRow } = older;
  const { row: newRow } = newer;
  return {
    sessionId: newRow.sessionId,
    newName: newer.name,
    oldName: older.name,
    oldChars: promptText(oldRow.body).head.length,
    newChars: promptText(newRow.body).head.length,
    chained: 'previous_response_id' in newRow.body,
    divergence: divergence(oldRow.body, newRow.body),
    settings: settingsDiffer(oldRow.body, newRow.body),
  };
}

export function pairBodies(rows: readonly BodyRow[]): Pairing[] {
  const sessions = Map.groupBy(rows, (row) => row.sessionId);
  const pairings: Pairing[] = [];
  for (const list of sessions.values()) {
    let real: Named | undefined;
    let reals = 0;
    let warms = 0;
    for (const row of list) {
      const warm = isWarm(row);
      const name = warm ? `warm ${(warms += 1)}` : `request ${(reals += 1)}`;
      if (real !== undefined) {
        pairings.push(compare(real, { row, name }));
      }
      if (!warm) {
        real = { row, name };
      }
    }
  }
  return pairings;
}

export function describePairing(pairing: Pairing): string[] {
  const { divergence: found } = pairing;
  const lines: string[] = [];
  const size = `old prompt ${pairing.oldChars} chars, new ${pairing.newChars}`;
  if (found === undefined) {
    lines.push(`${pairing.newName} extends ${pairing.oldName} (${size})`);
  } else {
    lines.push(
      `${pairing.newName} changed ${found.label} at char ${found.offset}, ${percent(found.share)} into ${pairing.oldName}'s prompt (${size})`,
      `  path: ${pathText(found.path)}`,
      `  ${pairing.oldName}: ${found.old}`,
      `  ${pairing.newName}: ${found.new}`,
    );
  }
  if (pairing.chained) {
    lines.push('  sent as a chained WebSocket delta: only the new items went on the wire');
  }
  if (pairing.settings.length > 0) {
    lines.push(`  settings differ: ${pairing.settings.join(', ')}`);
  }
  return lines;
}

export function describeBodies(rows: readonly BodyRow[]): string[] {
  const lines: string[] = [];
  let current = '';
  for (const pairing of pairBodies(rows)) {
    if (pairing.sessionId !== current) {
      current = pairing.sessionId;
      lines.push('', `session ${current}`);
    }
    lines.push(...describePairing(pairing).map((line) => `  ${line}`));
  }
  return lines;
}
