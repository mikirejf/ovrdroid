import type { Patch } from '../patch/patches.ts';

export interface Token {
  kind: 'ident' | 'other';
  text: string;
}

export const REBASE_STATUSES = ['rebased', 'unchanged', 'ambiguous', 'missing', 'no-tail'] as const;

export type RebaseStatus = (typeof REBASE_STATUSES)[number];

export interface Rebase {
  name: string;
  status: RebaseStatus;
  renames: Record<string, string>;
  find: string;
  until?: string;
  replace: string;
  unresolved: string[];
  collisions: string[];
  matches: number;
}

export interface HolePattern {
  source: string;
  names: string[];
}

const KEYWORDS = new Set(
  (
    'let const var function async await return if else for of in new this catch try finally ' +
    'class extends static get set typeof void delete instanceof continue break switch case ' +
    'default do while throw super yield import export true false null undefined arguments ' +
    'Object Math Date Set Map WeakMap Promise Error Symbol Number String Array JSON Boolean ' +
    'RegExp Function Intl Buffer Infinity NaN require ' +
    'setTimeout clearTimeout process globalThis'
  ).split(' '),
);

const HOLE = '([A-Za-z_$][\\w$]*)';
const QUOTES = new Set(['"', "'", '`']);
const DIVIDES_AFTER = /[\w$)\]]/u;
const IDENT_START = /[a-z_$]/iu;
const IDENT_PART = /[\w$]/u;
const DIGIT = /\d/u;
const REGEX_SPECIAL = /[.*+?^${}()|[\]\\]/gu;

function escape(text: string): string {
  return text.replace(REGEX_SPECIAL, '\\$&');
}

function endOfString(text: string, at: number): number {
  const quote = text[at];
  let i = at + 1;
  while (i < text.length) {
    const ch = text[i];
    if (ch === '\\') {
      i += 2;
      continue;
    }
    i += 1;
    if (ch === quote) {
      break;
    }
  }
  return i;
}

function endOfWord(text: string, at: number): number {
  let i = at;
  while (i < text.length && IDENT_PART.test(text[i] ?? '')) {
    i += 1;
  }
  return i;
}

function endOfRegex(text: string, at: number): number {
  let i = at + 1;
  let inClass = false;
  while (i < text.length) {
    const ch = text[i];
    if (ch === '\\') {
      i += 2;
      continue;
    }
    i += 1;
    if (ch === '[') {
      inClass = true;
    } else if (ch === ']') {
      inClass = false;
    } else if (ch === '/' && !inClass) {
      break;
    }
  }
  return endOfWord(text, i);
}

function startsRegex(text: string, at: number): boolean {
  if (text[at + 1] === '*' || text[at + 1] === '/') {
    return false;
  }
  const before = text.slice(0, at).trimEnd().at(-1);
  return before === undefined || !DIVIDES_AFTER.test(before);
}

function isHole(text: string, start: number, word: string): boolean {
  if (word.startsWith('$') || KEYWORDS.has(word)) {
    return false;
  }
  const before = text[start - 1];
  if (before === '.' && text.slice(start - 3, start) !== '...') {
    return false;
  }
  return !((before === '{' || before === ',') && text[start + word.length] === ':');
}

export function tokenize(text: string): Token[] {
  const tokens: Token[] = [];
  let other = '';
  let i = 0;
  const flush = (): void => {
    if (other !== '') {
      tokens.push({ kind: 'other', text: other });
      other = '';
    }
  };
  while (i < text.length) {
    const ch = text[i] ?? '';
    if (QUOTES.has(ch)) {
      const end = endOfString(text, i);
      other += text.slice(i, end);
      i = end;
    } else if (ch === '/' && startsRegex(text, i)) {
      const end = endOfRegex(text, i);
      other += text.slice(i, end);
      i = end;
    } else if (DIGIT.test(ch)) {
      const end = endOfWord(text, i + 1);
      other += text.slice(i, end);
      i = end;
    } else if (IDENT_START.test(ch)) {
      const end = endOfWord(text, i + 1);
      const word = text.slice(i, end);
      if (isHole(text, i, word)) {
        flush();
        tokens.push({ kind: 'ident', text: word });
      } else {
        other += word;
      }
      i = end;
    } else {
      other += ch;
      i += 1;
    }
  }
  flush();
  return tokens;
}

export function holePattern(text: string, known: ReadonlyMap<string, string> = new Map()) {
  const names: string[] = [];
  let source = '';
  for (const token of tokenize(text)) {
    if (token.kind === 'other') {
      source += escape(token.text);
      continue;
    }
    const fixed = known.get(token.text);
    if (fixed !== undefined) {
      source += escape(fixed);
      continue;
    }
    const seen = names.indexOf(token.text);
    if (seen === -1) {
      names.push(token.text);
      source += HOLE;
    } else {
      source += `\\${seen + 1}`;
    }
  }
  return { source, names } satisfies HolePattern;
}

function renameIn(text: string, map: ReadonlyMap<string, string>): string {
  return tokenize(text)
    .map((token) => (token.kind === 'ident' ? (map.get(token.text) ?? token.text) : token.text))
    .join('');
}

function holeNames(text: string): string[] {
  return [
    ...new Set(
      tokenize(text)
        .filter((token) => token.kind === 'ident')
        .map((token) => token.text),
    ),
  ];
}

function isLiteralAnchor(patch: Patch, source: string): boolean {
  const at = source.indexOf(patch.find);
  if (at === -1 || source.includes(patch.find, at + 1)) {
    return false;
  }
  return patch.until === undefined || source.includes(patch.until, at + patch.find.length);
}

function withUntil(rebase: Rebase, until: string | undefined): Rebase {
  return until === undefined ? rebase : { ...rebase, until };
}

function plain(patch: Patch, status: RebaseStatus, matches: number): Rebase {
  return withUntil(
    {
      name: patch.name,
      status,
      renames: {},
      find: patch.find,
      replace: patch.replace,
      unresolved: [],
      collisions: [],
      matches,
    },
    patch.until,
  );
}

type Anchored = [find: string, until?: string];

function settle(patch: Patch, map: ReadonlyMap<string, string>, found: Anchored): Rebase {
  const moved = [...map].filter(([from, to]) => from !== to);
  const changed = new Set(moved.map(([, to]) => to));
  const loose = holeNames(patch.replace).filter((name) => !map.has(name));
  const [find, until] = found;
  return withUntil(
    {
      name: patch.name,
      status: moved.length === 0 ? 'unchanged' : 'rebased',
      renames: Object.fromEntries(moved),
      find,
      replace: renameIn(patch.replace, map),
      unresolved: loose,
      collisions: loose.filter((name) => changed.has(name)),
      matches: 1,
    },
    until,
  );
}

function takeGroups(
  names: readonly string[],
  match: RegExpExecArray,
  map: Map<string, string>,
): void {
  for (const [index, name] of names.entries()) {
    const to = match[index + 1];
    if (to !== undefined) {
      map.set(name, to);
    }
  }
}

export function rebasePatch(patch: Patch, source: string): Rebase {
  if (isLiteralAnchor(patch, source)) {
    return plain(patch, 'unchanged', 1);
  }
  const anchor = holePattern(patch.find);
  const found = [...source.matchAll(new RegExp(anchor.source, 'gu'))];
  const [first] = found;
  if (first === undefined) {
    return plain(patch, 'missing', 0);
  }
  if (found.length > 1) {
    return plain(patch, 'ambiguous', found.length);
  }

  const map = new Map<string, string>();
  takeGroups(anchor.names, first, map);
  const [head] = first;

  if (patch.until === undefined) {
    return settle(patch, map, [head]);
  }

  const tail = holePattern(patch.until, map);
  const after = new RegExp(tail.source, 'gu');
  after.lastIndex = first.index + head.length;
  const end = after.exec(source);
  if (end === null) {
    return plain(patch, 'no-tail', 1);
  }
  takeGroups(tail.names, end, map);
  const [tailText] = end;
  return settle(patch, map, [head, tailText]);
}

export function rebaseAll(list: readonly Patch[], source: string): Rebase[] {
  return list.map((patch) => rebasePatch(patch, source));
}

const NAME_WIDTH = 34;
const STATUS_WIDTH = 10;

function formatRebase(result: Rebase): string {
  const notes = Object.entries(result.renames).map(([from, to]) => `${from}->${to}`);
  if (result.status === 'ambiguous') {
    notes.push(`${result.matches} places match`);
  }
  if (result.unresolved.length > 0) {
    notes.push(`unresolved: ${result.unresolved.join(' ')}`);
  }
  if (result.collisions.length > 0) {
    notes.push(`collides: ${result.collisions.join(' ')}`);
  }
  return [result.name.padEnd(NAME_WIDTH), result.status.padEnd(STATUS_WIDTH), notes.join(' ')]
    .join(' ')
    .trimEnd();
}

export function formatRebases(results: readonly Rebase[]): string {
  return results.map((result) => formatRebase(result)).join('\n');
}

export function summariseRebases(results: readonly Rebase[]): string {
  return REBASE_STATUSES.map(
    (status) => `${results.filter((result) => result.status === status).length} ${status}`,
  ).join(', ');
}

export function stuckRebases(results: readonly Rebase[]): Rebase[] {
  return results.filter((result) => result.status !== 'rebased' && result.status !== 'unchanged');
}
