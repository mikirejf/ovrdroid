import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

import type { BodyRow, JsonObject } from './bodies.ts';
import { compareBodies, describeBodies, isList, isRecord, pathText, toJson } from './bodies.ts';
import { markerPaths } from './compaction-turn-report.ts';

const SECTION = /^=== (?<name>.+) ===$/mu;
const TIMESTAMP = /^Timestamp: (?<at>.+)$/mu;
const PROXY_LOG = /^v1-messages-.*\.log$/u;
const OPENING_MESSAGES = 3;
const BODY_LABEL = 'Body:\n';
const AUTH_ID = /^Auth: .*\bauth_id=(?<id>[^,\s]+)/mu;
const SESSION_HEADER = /^X-Session-Id: \S/imu;
const ACCOUNT_CHARS = 8;

export interface ProxyUsage {
  input: number;
  read: number;
  written: number;
}

export interface ProxyEntry {
  at: string;
  downstream: JsonObject | undefined;
  upstream: JsonObject | undefined;
  usage: ProxyUsage | undefined;
  account: string;
  sentSessionId: boolean;
}

function sectionsOf(text: string): Map<string, string> {
  const parts = text.split(SECTION);
  const sections = new Map<string, string>();
  for (let index = 1; index + 1 < parts.length; index += 2) {
    sections.set(parts[index] ?? '', parts[index + 1] ?? '');
  }
  return sections;
}

function jsonObject(text: string): JsonObject | undefined {
  try {
    const value = toJson(JSON.parse(text.trim()));
    return isRecord(value) ? value : undefined;
  } catch {
    return undefined;
  }
}

function bodyOf(section: string): string {
  const at = section.indexOf(BODY_LABEL);
  return at === -1 ? '' : section.slice(at + BODY_LABEL.length);
}

function lastNumbered(sections: Map<string, string>, prefix: string): string {
  return [...sections.entries()].findLast(([name]) => name.startsWith(prefix))?.[1] ?? '';
}

function numberAt(usage: JsonObject, key: string): number {
  const value = usage[key];
  return typeof value === 'number' ? value : 0;
}

function usageOf(stream: string): ProxyUsage | undefined {
  let found: ProxyUsage | undefined;
  for (const line of stream.split('\n')) {
    if (!line.startsWith('data: ')) {
      continue;
    }
    const event = jsonObject(line.slice('data: '.length));
    const message = event?.['message'];
    const usage = event?.['usage'] ?? (isRecord(message) ? message['usage'] : undefined);
    if (isRecord(usage) && 'cache_read_input_tokens' in usage) {
      found = {
        input: numberAt(usage, 'input_tokens'),
        read: numberAt(usage, 'cache_read_input_tokens'),
        written: numberAt(usage, 'cache_creation_input_tokens'),
      };
    }
  }
  return found;
}

function accountOf(section: string): string {
  const id = AUTH_ID.exec(section)?.groups?.['id'];
  return id === undefined
    ? 'unknown'
    : new Bun.CryptoHasher('sha256').update(id).digest('hex').slice(0, ACCOUNT_CHARS);
}

export function parseProxyLog(text: string): ProxyEntry {
  const sections = sectionsOf(text);
  const info = sections.get('REQUEST INFO') ?? '';
  const forwarded = lastNumbered(sections, 'API REQUEST ');
  return {
    at: TIMESTAMP.exec(info)?.groups?.['at']?.trim() ?? '',
    downstream: jsonObject(sections.get('REQUEST BODY') ?? ''),
    upstream: jsonObject(bodyOf(forwarded)),
    usage: usageOf(bodyOf(lastNumbered(sections, 'API RESPONSE '))),
    account: accountOf(forwarded),
    sentSessionId: SESSION_HEADER.test(sections.get('HEADERS') ?? ''),
  };
}

function opensIn(entry: ProxyEntry, marker: string): boolean {
  const messages = entry.downstream?.['messages'];
  return isList(messages) && JSON.stringify(messages.slice(0, OPENING_MESSAGES)).includes(marker);
}

export function proxyEntries(folder: string, since: number, marker: string): ProxyEntry[] {
  return readdirSync(folder)
    .filter((name) => PROXY_LOG.test(name))
    .map((name) => path.join(folder, name))
    .filter((file) => statSync(file).mtimeMs >= since)
    .toSorted()
    .map((file) => parseProxyLog(readFileSync(file, 'utf-8')))
    .filter((entry) => opensIn(entry, marker));
}

function rowsOf(entries: readonly ProxyEntry[], side: 'downstream' | 'upstream'): BodyRow[] {
  return entries.flatMap((entry, index) => {
    const body = entry[side];
    return body === undefined
      ? []
      : [{ t: index, sessionId: side, assistantMessageId: `${index}`, route: '', body }];
  });
}

function usageText(usage: ProxyUsage | undefined): string {
  return usage === undefined
    ? 'no usage in the logged response'
    : `read ${usage.read}, wrote ${usage.written}, uncached ${usage.input}`;
}

function proxyChange(entry: ProxyEntry): string[] {
  const { downstream, upstream } = entry;
  if (downstream === undefined || upstream === undefined) {
    return ['  the log lacks the request Droid sent or the one the proxy forwarded'];
  }
  const { divergence, settings } = compareBodies(downstream, upstream);
  const before = markerPaths(downstream);
  const after = markerPaths(upstream);
  const lines = [
    divergence === undefined
      ? '  the proxy forwarded a prompt that extends what Droid sent'
      : `  the proxy changed ${divergence.label} at ${pathText(divergence.path)}: "${divergence.old}" became "${divergence.new}"`,
  ];
  if (settings.length > 0) {
    lines.push(`  the proxy changed settings: ${settings.join(', ')}`);
  }
  if (before.join(',') !== after.join(',')) {
    lines.push(
      `  the proxy moved cache markers: Droid ${before.join(', ') || 'none'}; forwarded ${after.join(', ') || 'none'}`,
    );
  }
  return lines;
}

export function accountMoves(entries: readonly ProxyEntry[]): string {
  const moves = entries.flatMap((entry, index) => {
    const before = entries[index - 1];
    return before !== undefined && before.account !== entry.account
      ? [`request ${index + 1} moved from account ${before.account} to ${entry.account}`]
      : [];
  });
  return moves.length === 0
    ? `every request went to account ${entries[0]?.account ?? 'none'}`
    : moves.join('; ');
}

export function describeProxyEntries(entries: readonly ProxyEntry[]): string[] {
  const lines = entries.flatMap((entry, index) => [
    `proxy request ${index + 1} at ${entry.at} on account ${entry.account}, ${entry.sentSessionId ? 'with' : 'without'} a session id from Droid: ${usageText(entry.usage)}; forwarded markers at ${entry.upstream === undefined ? 'unknown' : markerPaths(entry.upstream).join(', ') || 'none'}`,
    ...proxyChange(entry),
  ]);
  return [
    accountMoves(entries),
    ...lines,
    '',
    'what Droid sent, each request against the one before:',
    ...describeBodies(rowsOf(entries, 'downstream')),
    '',
    'what the proxy forwarded, each request against the one before:',
    ...describeBodies(rowsOf(entries, 'upstream')),
  ];
}
