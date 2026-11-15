import { whole } from '../cli.ts';
import type { BodyRow, Json, JsonObject } from './bodies.ts';
import {
  describePairing,
  isList,
  isOneShot,
  isRecord,
  isWarm,
  pairBodies,
  pathText,
} from './bodies.ts';
import { kept } from './effort-cache-verdict.ts';
import type { UsageLine } from './logs.ts';
import type { WarmCheck } from './warm-verdict.ts';
import { describeChecks, warmPassed } from './warm-verdict.ts';

const MARKER = 'cache_control';
const MARKED_KEYS = ['system', 'tools', 'messages'];

type PathPart = string | number;

export interface TurnEvidence {
  rows: readonly BodyRow[];
  nextAt: number;
  compactedAt: readonly number[];
  usage: readonly UsageLine[];
}

export function markerPaths(body: JsonObject): string[] {
  const found: string[] = [];
  const walk = (node: Json, path: readonly PathPart[]): void => {
    if (isList(node)) {
      for (const [index, item] of node.entries()) {
        walk(item, [...path, index]);
      }
    } else if (isRecord(node)) {
      if (MARKER in node) {
        found.push(pathText(path));
      }
      for (const [key, item] of Object.entries(node)) {
        if (key !== MARKER) {
          walk(item, [...path, key]);
        }
      }
    }
  };
  for (const key of MARKED_KEYS) {
    if (key in body) {
      walk(body[key] ?? null, [key]);
    }
  }
  return found;
}

function messageCount(body: JsonObject): number {
  const { messages } = body;
  return isList(messages) ? messages.length : 0;
}

function mainRequests(rows: readonly BodyRow[]): BodyRow[] {
  return rows.filter((row) => !isWarm(row) && !isOneShot(row));
}

export function describeRequests(rows: readonly BodyRow[], nextAt: number): string[] {
  return mainRequests(rows).map((row, index) => {
    const turn = row.t >= nextAt ? 'next turn' : 'first turn';
    return `request ${index + 1} (${turn}, sent ${new Date(row.t).toISOString()}): ${messageCount(row.body)} messages, markers at ${markerPaths(row.body).join(', ') || 'none'}`;
  });
}

interface Names {
  newName: string;
  oldName: string;
}

function pairingAt(real: readonly BodyRow[], index: number, names: Names) {
  const pair = [real[index - 1], real[index]].filter((row) => row !== undefined);
  const pairing = pair.length === 2 ? pairBodies(pair).at(0) : undefined;
  return pairing === undefined ? undefined : { ...pairing, ...names };
}

export function nextTurnPairing(rows: readonly BodyRow[], nextAt: number): string[] {
  const real = mainRequests(rows);
  const next = real.findIndex((row) => row.t >= nextAt);
  if (next < 1) {
    return ['no request on each side of the next user message'];
  }
  const pairing = pairingAt(real, next, {
    newName: `request ${next + 1} (first of the next turn)`,
    oldName: `request ${next} (last before the next user message)`,
  });
  if (pairing === undefined) {
    return ['the two requests around the next user message belong to different sessions'];
  }
  return describePairing(pairing);
}

function check(pass: boolean, passed: string, failed: string): WarmCheck {
  return { pass, text: pass ? passed : failed };
}

function follows(real: readonly BodyRow[], index: number, compactedAt: readonly number[]): boolean {
  const older = real[index - 1];
  const newer = real[index];
  return (
    older !== undefined &&
    newer !== undefined &&
    compactedAt.some((at) => older.t < at && at <= newer.t)
  );
}

function extensionCheck(real: readonly BodyRow[], index: number, newName: string): WarmCheck {
  const oldName = `request ${index}`;
  const pairing = pairingAt(real, index, { newName, oldName });
  if (pairing === undefined) {
    return check(false, '', `${newName} and ${oldName} belong to different sessions`);
  }
  const found = pairing.divergence;
  return check(
    found === undefined,
    `${newName} extends ${oldName}, so it reads the cache ${oldName} wrote`,
    `${newName} stops extending ${oldName} at ${found?.label ?? ''} (${pathText(found?.path ?? [])}), so it re-writes the cache from there`,
  );
}

function readingChecks(real: readonly BodyRow[], next: number, evidence: TurnEvidence) {
  const checks: WarmCheck[] = [];
  let beforeCompaction = 0;
  let compacted = false;
  for (let index = 1; index < next; index += 1) {
    const name = `request ${index + 1}`;
    if (follows(real, index, evidence.compactedAt)) {
      compacted = true;
      checks.push(
        check(
          true,
          `${name} is the first after a compaction, so it starts a new cached prefix`,
          '',
        ),
      );
    } else {
      beforeCompaction += compacted ? 0 : 1;
      checks.push(extensionCheck(real, index, name));
    }
  }
  checks.unshift(
    check(
      compacted,
      'the reading turn compacted between two of its requests',
      'no request of the reading turn came after a compaction, so the compaction landed outside the turn under test',
    ),
    check(
      beforeCompaction > 0,
      `the reading turn sent ${beforeCompaction + 1} requests before it compacted`,
      'the reading turn sent fewer than two requests before it compacted, so nothing tested turn-to-turn reuse',
    ),
  );
  return checks;
}

function nextExtensionCheck(real: readonly BodyRow[], next: number, evidence: TurnEvidence) {
  const name = `request ${next + 1} (the next user message)`;
  if (follows(real, next, evidence.compactedAt)) {
    return check(
      false,
      '',
      `${name} came right after a compaction, so the run cannot judge it against the request before`,
    );
  }
  return extensionCheck(real, next, name);
}

function lineAt(line: UsageLine): number {
  return Date.parse(line.at);
}

function cacheReadCheck(evidence: TurnEvidence): WarmCheck {
  const before = evidence.usage.findLast((line) => lineAt(line) < evidence.nextAt);
  const after = evidence.usage.find((line) => lineAt(line) >= evidence.nextAt);
  if (before === undefined || after === undefined) {
    return check(false, '', "Droid's usage log has no line on each side of the next user message");
  }
  const prefix = before.cacheReadInputTokens + before.cachedTokensWritten;
  const usage = { cacheRead: after.cacheReadInputTokens, cacheWrite: after.cachedTokensWritten };
  return check(
    prefix > 0 && kept(usage, prefix),
    `the next user message read ${whole(usage.cacheRead)} of the ${whole(prefix)}-token cached prefix and wrote ${whole(usage.cacheWrite)}`,
    `the next user message read only ${whole(usage.cacheRead)} of the ${whole(prefix)}-token cached prefix and wrote ${whole(usage.cacheWrite)}`,
  );
}

function compactionTurnChecks(evidence: TurnEvidence): WarmCheck[] {
  const real = mainRequests(evidence.rows);
  const next = real.findIndex((row) => row.t >= evidence.nextAt);
  if (next < 1) {
    return [check(false, '', 'no main request on each side of the next user message')];
  }
  return [
    ...readingChecks(real, next, evidence),
    nextExtensionCheck(real, next, evidence),
    cacheReadCheck(evidence),
  ];
}

export interface TurnVerdict {
  pass: boolean;
  text: string;
}

export function compactionTurnVerdict(evidence: TurnEvidence): TurnVerdict {
  const checks = compactionTurnChecks(evidence);
  const pass = warmPassed(checks);
  return {
    pass,
    text: [
      describeChecks(checks),
      pass
        ? 'PASS: every main request extended the one before it, bar the first after each compaction, and the next user message read its cached prefix.'
        : 'FAIL: the session busted its prompt cache around the compaction, so it spent more tokens than it should.',
    ].join('\n'),
  };
}
