import type { Patch } from './patches.ts';
import { findMarker, markerDigest, markerStatement } from './patches.ts';

export type Status =
  | { kind: 'applied'; digest: string }
  | { kind: 'stale'; digest: string; current: string }
  | { kind: 'pending' }
  | { kind: 'missing'; names: readonly string[] };

function soleOffset(haystack: string, needle: string): number | undefined {
  const first = haystack.indexOf(needle);
  return first !== -1 && !haystack.includes(needle, first + 1) ? first : undefined;
}

export function countOccurrences(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1;
}

export function statusOf(source: string, list: readonly Patch[]): Status {
  const found = findMarker(source);
  const current = markerDigest(list);

  if (found !== undefined) {
    return found === current
      ? { kind: 'applied', digest: found }
      : { kind: 'stale', digest: found, current };
  }

  const names = list
    .filter((patch) => soleOffset(source, patch.find) === undefined)
    .map((patch) => patch.name);

  return names.length > 0 ? { kind: 'missing', names } : { kind: 'pending' };
}

export function describeStatus(status: Status): string {
  if (status.kind === 'applied') {
    return `applied ${status.digest}`;
  }
  if (status.kind === 'stale') {
    return `stale ${status.digest} (current ${status.current})`;
  }
  if (status.kind === 'missing') {
    return `missing: ${status.names.join(', ')}`;
  }
  return 'pending';
}

export function patchSource(source: string, list: readonly Patch[]): string {
  let out = source;

  for (const patch of list) {
    const at = soleOffset(out, patch.find);
    if (at === undefined) {
      throw new Error(
        `patch ${patch.name}: expected 1 occurrence, found ${countOccurrences(out, patch.find)}`,
      );
    }
    out = out.slice(0, at) + patch.replace + out.slice(at + patch.find.length);
  }

  if (findMarker(out) !== undefined) {
    throw new Error('source already carries an overdroid marker');
  }

  return out + markerStatement(list);
}
