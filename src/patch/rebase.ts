import type { Patch } from './patches.ts';
import type { HolePattern } from './tokens.ts';
import { freeNames, holePattern, literalParts, renameIn } from './tokens.ts';

export const REBASE_STATUSES = [
  'rebased',
  'unchanged',
  'unresolved',
  'collides',
  'ambiguous',
  'missing',
  'no-tail',
  'no-lookup',
] as const;

export type RebaseStatus = (typeof REBASE_STATUSES)[number];

export interface Rebase {
  name: string;
  status: RebaseStatus;
  renames: Record<string, string>;
  find: string;
  until?: string;
  lookups?: readonly string[];
  replace: string;
  unresolved: string[];
  collisions: string[];
  matches: number;
}

export const PAYLOAD_PREFIX = '$OD';

interface Found {
  text: string;
  match: RegExpExecArray;
}

function anchorHits(find: string, pattern: RegExp, modules: readonly string[]): Found[] {
  const parts = literalParts(find);
  return modules
    .filter((text) => parts.every((part) => text.includes(part)))
    .flatMap((text) => [...text.matchAll(pattern)].map((match) => ({ text, match })));
}

function stuck(patch: Patch, status: RebaseStatus, matches: number): Rebase {
  return {
    ...patch,
    status,
    renames: {},
    unresolved: [],
    collisions: [],
    matches,
  };
}

function collisionsIn(names: readonly string[], map: ReadonlyMap<string, string>): string[] {
  const owners = new Map<string, string[]>();
  for (const name of names) {
    const to = map.get(name) ?? name;
    owners.set(to, [...(owners.get(to) ?? []), name]);
  }
  return [...owners.values()].filter((group) => group.length > 1).flat();
}

function settledStatus(
  unresolved: readonly string[],
  collisions: readonly string[],
  moved: readonly unknown[],
): RebaseStatus {
  if (unresolved.length > 0) {
    return 'unresolved';
  }
  if (collisions.length > 0) {
    return 'collides';
  }
  return moved.length === 0 ? 'unchanged' : 'rebased';
}

function settle(patch: Patch, map: ReadonlyMap<string, string>, anchored: Anchored): Rebase {
  const moved = [...map].filter(([from, to]) => from !== to);
  const used = freeNames(patch.replace);
  const unresolved = used.filter((name) => !map.has(name));
  const collisions = collisionsIn(used, map);
  const status = settledStatus(unresolved, collisions, moved);
  const rebase: Rebase = {
    name: patch.name,
    status,
    renames: Object.fromEntries(moved),
    find: anchored.find,
    replace: renameIn(patch.replace, map),
    unresolved,
    collisions,
    matches: 1,
  };
  const withUntil = anchored.until === undefined ? rebase : { ...rebase, until: anchored.until };
  return patch.lookups === undefined ? withUntil : { ...withUntil, lookups: anchored.lookups };
}

interface Anchored {
  find: string;
  until?: string;
  lookups: string[];
}

function groupsOf(names: readonly string[], match: RegExpExecArray): [string, string][] {
  const groups: [string, string][] = [];
  for (const [index, name] of names.entries()) {
    const to = match[index + 1];
    if (to !== undefined) {
      groups.push([name, to]);
    }
  }
  return groups;
}

function soleHit(text: string, pattern: HolePattern): RegExpExecArray | undefined {
  const found = [...text.matchAll(new RegExp(pattern.source, 'gu'))];
  return found.length === 1 ? found[0] : undefined;
}

export function rebasePatch(patch: Patch, modules: readonly string[]): Rebase {
  const anchor = holePattern(patch.find);
  const found = anchorHits(patch.find, new RegExp(anchor.source, 'gu'), modules);
  const [head] = found;
  if (head === undefined) {
    return stuck(patch, 'missing', 0);
  }
  if (found.length > 1) {
    return stuck(patch, 'ambiguous', found.length);
  }

  const map = new Map(groupsOf(anchor.names, head.match));
  const anchored: Anchored = { find: head.match[0], lookups: [] };

  if (patch.until !== undefined) {
    const tail = holePattern(patch.until, map);
    const after = new RegExp(tail.source, 'gu');
    after.lastIndex = head.match.index + head.match[0].length;
    const end = after.exec(head.text);
    if (end === null) {
      return stuck(patch, 'no-tail', 1);
    }
    for (const [from, to] of groupsOf(tail.names, end)) {
      map.set(from, to);
    }
    anchored.until = end[0];
  }

  const wanted = new Set(freeNames(patch.replace));
  for (const lookup of patch.lookups ?? []) {
    const pattern = holePattern(lookup, map);
    const hit = soleHit(head.text, pattern);
    if (hit === undefined) {
      return stuck(patch, 'no-lookup', 1);
    }
    for (const [from, to] of groupsOf(pattern.names, hit)) {
      if (wanted.has(from)) {
        map.set(from, to);
      }
    }
    anchored.lookups.push(hit[0]);
  }

  return settle(patch, map, anchored);
}

export function rebaseAll(list: readonly Patch[], modules: readonly string[]): Rebase[] {
  if (modules.some((text) => text.includes(PAYLOAD_PREFIX))) {
    throw new Error(
      `the source already uses the ${PAYLOAD_PREFIX} prefix reserved for patch payload names`,
    );
  }
  return list.map((patch) => rebasePatch(patch, modules));
}

export function applies(rebase: Rebase): boolean {
  return rebase.status === 'rebased' || rebase.status === 'unchanged';
}
