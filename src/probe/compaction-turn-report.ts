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

const MARKER = 'cache_control';
const MARKED_KEYS = ['system', 'tools', 'messages'];

type PathPart = string | number;

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

export function describeRequests(rows: readonly BodyRow[], nextAt: number): string[] {
  let index = 0;
  return rows
    .filter((row) => !isWarm(row) && !isOneShot(row))
    .map((row) => {
      index += 1;
      const turn = row.t >= nextAt ? 'next turn' : 'first turn';
      return `request ${index} (${turn}): ${messageCount(row.body)} messages, markers at ${markerPaths(row.body).join(', ') || 'none'}`;
    });
}

export function nextTurnPairing(rows: readonly BodyRow[], nextAt: number): string[] {
  const real = rows.filter((row) => !isWarm(row) && !isOneShot(row));
  const next = real.findIndex((row) => row.t >= nextAt);
  if (next < 1) {
    return ['no request on each side of the next user message'];
  }
  const pairing = pairBodies([real[next - 1], real[next]].filter((row) => row !== undefined)).at(0);
  if (pairing === undefined) {
    return ['the two requests around the next user message belong to different sessions'];
  }
  return describePairing({
    ...pairing,
    oldName: `request ${next} (last before the next user message)`,
    newName: `request ${next + 1} (first of the next turn)`,
  });
}
