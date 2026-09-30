import type { Patch } from '../patch/patches.ts';
import { findMarker, markerDigest, markerStatement } from '../patch/patches.ts';
import type { Rebase } from '../patch/rebase.ts';
import { applies, rebaseAll } from '../patch/rebase.ts';
import type { App, AppModule } from './graph.ts';

export type Status =
  | { kind: 'applied'; digest: string }
  | { kind: 'stale'; digest: string; current: string }
  | { kind: 'pending' }
  | { kind: 'missing'; names: readonly string[] };

export function countOccurrences(haystack: string, needle: string): number {
  const stride = Math.max(needle.length, 1);
  let count = 0;
  for (let at = haystack.indexOf(needle); at !== -1; at = haystack.indexOf(needle, at + stride)) {
    count += 1;
  }
  return count;
}

interface Hit {
  kind: 'hit';
  module: AppModule;
  start: number;
  end: number;
}

interface Miss {
  kind: 'miss';
  count: number;
}

function copyOf(module: AppModule): AppModule {
  return { name: module.name, text: module.text };
}

function endOfRange(text: string, patch: Patch, start: number): number | undefined {
  const from = start + patch.find.length;
  if (patch.until === undefined) {
    return from;
  }
  const until = text.indexOf(patch.until, from);
  return until === -1 ? undefined : until + patch.until.length;
}

function soleHit(app: readonly AppModule[], patch: Patch): Hit | Miss {
  let hit: Hit | undefined;
  let count = 0;

  for (const module of app) {
    const start = module.text.indexOf(patch.find);
    if (start === -1) {
      continue;
    }
    count += countOccurrences(module.text, patch.find);
    if (hit !== undefined) {
      continue;
    }
    const end = endOfRange(module.text, patch, start);
    if (end !== undefined) {
      hit = { kind: 'hit', module, start, end };
    }
  }

  return count === 1 && hit !== undefined ? hit : { kind: 'miss', count };
}

function describeMiss(patch: Patch, miss: Miss): string {
  return miss.count === 1
    ? `patch ${patch.name}: until not found after find`
    : `patch ${patch.name}: expected 1 occurrence, found ${miss.count}`;
}

function rebaseOnto(app: App, list: readonly Patch[]): Rebase[] {
  return rebaseAll(
    list,
    app.map((module) => module.text),
  );
}

export function describeDrift(rebase: Rebase): string {
  if (rebase.status === 'unresolved') {
    return `${rebase.name} (free names: ${rebase.unresolved.join(' ')})`;
  }
  if (rebase.status === 'collides') {
    return `${rebase.name} (names renamed onto one: ${rebase.collisions.join(' ')})`;
  }
  if (rebase.status === 'ambiguous') {
    return `${rebase.name} (${rebase.matches} places match)`;
  }
  return `${rebase.name} (${rebase.status})`;
}

export function statusOf(app: App, list: readonly Patch[]): Status {
  const found = findMarker(app[0].text);
  const current = markerDigest(list);

  if (found !== undefined) {
    return found === current
      ? { kind: 'applied', digest: found }
      : { kind: 'stale', digest: found, current };
  }

  const names = rebaseOnto(app, list)
    .filter((rebase) => !applies(rebase))
    .map((rebase) => rebase.name);

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

export function patchSource(app: App, list: readonly Patch[]): App {
  const [head, ...rest] = app;
  const entry = copyOf(head);
  const out: App = [entry, ...rest.map((module) => copyOf(module))];

  const rebased = rebaseOnto(app, list);
  const drift = rebased.filter((rebase) => !applies(rebase));
  if (drift.length > 0) {
    throw new Error(
      `markers not found (Droid version drift): ${drift.map((rebase) => describeDrift(rebase)).join(', ')}`,
    );
  }

  for (const patch of rebased) {
    const hit = soleHit(out, patch);
    if (hit.kind === 'miss') {
      throw new Error(describeMiss(patch, hit));
    }
    const { module, start, end } = hit;
    module.text = module.text.slice(0, start) + patch.replace + module.text.slice(end);
  }

  if (findMarker(entry.text) !== undefined) {
    throw new Error('source already carries an ovrdroid marker');
  }
  entry.text += markerStatement(list);

  return out;
}
