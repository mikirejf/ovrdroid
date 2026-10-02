import type { Token } from '../patch/tokens.ts';
import { blockEnd, freeNames, renameIn, tokenize } from '../patch/tokens.ts';

const CONTEXT_TOKENS = 12;
const MERGE_GAP = 3;
const ANY_NAME = '\0';
const MAX_ROUNDS = 4;

export interface Hunk {
  before: string;
  fixture: string;
  bundle: string;
}

export interface Alignment {
  hunks: Hunk[];
  renames: Map<string, string>;
}

type Step = readonly [fixture: Token | undefined, bundle: Token | undefined];

const PIECES = /[\w$]+|./gsu;

function diffTokens(source: string): Token[] {
  return tokenize(source).flatMap((token): Token[] =>
    token.kind === 'ident'
      ? [token]
      : [...token.text.matchAll(PIECES)].map(([piece]) => ({ kind: 'other', text: piece })),
  );
}

function pairing(renames: ReadonlyMap<string, string>): (fixture: Token, bundle: Token) => boolean {
  const taken = new Set(renames.values());
  return (fixture, bundle) => {
    if (fixture.kind !== bundle.kind) {
      return false;
    }
    if (fixture.kind === 'other') {
      return fixture.text === bundle.text;
    }
    const known = renames.get(bundle.text);
    return known === undefined ? !taken.has(fixture.text) : known === fixture.text;
  };
}

function fromEnd(tokens: readonly Token[]): [number, Token][] {
  return [...tokens.entries()].toReversed();
}

function commonSteps(
  old: readonly Token[],
  now: readonly Token[],
  renames: ReadonlyMap<string, string>,
): Step[] {
  const same = pairing(renames);
  const width = now.length + 1;
  const lengths = new Uint32Array((old.length + 1) * width);
  for (const [i, a] of fromEnd(old)) {
    for (const [j, b] of fromEnd(now)) {
      lengths[i * width + j] = same(a, b)
        ? (lengths[(i + 1) * width + j + 1] ?? 0) + 1
        : Math.max(lengths[(i + 1) * width + j] ?? 0, lengths[i * width + j + 1] ?? 0);
    }
  }
  const steps: Step[] = [];
  let i = 0;
  let j = 0;
  while (i < old.length || j < now.length) {
    const a = old[i];
    const b = now[j];
    if (a !== undefined && b !== undefined && same(a, b)) {
      steps.push([a, b]);
      i += 1;
      j += 1;
    } else if (
      b === undefined ||
      (a !== undefined && (lengths[(i + 1) * width + j] ?? 0) >= (lengths[i * width + j + 1] ?? 0))
    ) {
      steps.push([a, undefined]);
      i += 1;
    } else {
      steps.push([undefined, b]);
      j += 1;
    }
  }
  return steps;
}

interface Vote {
  fixture: string;
  bundle: string;
  count: number;
}

function votedRenames(steps: readonly Step[]): Map<string, string> {
  const votes = new Map<string, Vote>();
  for (const [a, b] of steps) {
    if (a?.kind === 'ident' && b?.kind === 'ident') {
      const key = `${a.text}${ANY_NAME}${b.text}`;
      const vote = votes.get(key) ?? { fixture: a.text, bundle: b.text, count: 0 };
      vote.count += 1;
      votes.set(key, vote);
    }
  }
  const toFixture = new Map<string, string>();
  const taken = new Set<string>();
  const open = (vote: Vote): boolean => !toFixture.has(vote.bundle) && !taken.has(vote.fixture);
  const counts = [...new Set([...votes.values()].map((vote) => vote.count))].toSorted(
    (x, y) => y - x,
  );
  for (const count of counts) {
    const level = [...votes.values()].filter((vote) => vote.count === count && open(vote));
    const contested = (vote: Vote): boolean =>
      level.some(
        (other) =>
          other !== vote && (other.fixture === vote.fixture || other.bundle === vote.bundle),
      );
    for (const vote of level.filter((candidate) => !contested(candidate))) {
      toFixture.set(vote.bundle, vote.fixture);
      taken.add(vote.fixture);
    }
  }
  return toFixture;
}

function sameRenames(a: ReadonlyMap<string, string>, b: ReadonlyMap<string, string>): boolean {
  return a.size === b.size && [...a].every(([from, to]) => b.get(from) === to);
}

function agrees([a, b]: Step, renames: ReadonlyMap<string, string>): boolean {
  if (a === undefined || b === undefined) {
    return false;
  }
  return a.kind === 'ident' ? renames.get(b.text) === a.text : a.text === b.text;
}

function joinedText(tokens: readonly (Token | undefined)[]): string {
  return tokens.map((token) => token?.text ?? '').join('');
}

export function alignTokens(fixture: string, bundle: string): Alignment {
  const old = diffTokens(fixture);
  const now = diffTokens(bundle);
  let renames = new Map<string, string>();
  let steps = commonSteps(old, now, renames);
  for (let round = 0; round < MAX_ROUNDS; round += 1) {
    const voted = votedRenames(steps);
    if (sameRenames(voted, renames)) {
      break;
    }
    renames = voted;
    steps = commonSteps(old, now, renames);
  }
  const agreeing = steps.map((step) => agrees(step, renames));
  const hunks: Hunk[] = [];
  let index = 0;
  while (index < steps.length) {
    if (agreeing[index] === true) {
      index += 1;
      continue;
    }
    const start = index;
    let end = index;
    while (index < steps.length && index - end < MERGE_GAP) {
      if (agreeing[index] !== true) {
        end = index + 1;
      }
      index += 1;
    }
    index = end;
    const span = steps.slice(start, end);
    hunks.push({
      before: joinedText(steps.slice(Math.max(0, start - CONTEXT_TOKENS), start).map(([a]) => a)),
      fixture: joinedText(span.map(([a]) => a)),
      bundle: renameIn(joinedText(span.map(([, b]) => b)), renames),
    });
  }
  return { hunks, renames };
}

export interface Translation {
  text: string;
  added: string[];
  reused: string[];
}

export function translate(
  fixture: string,
  bundle: string,
  renames: ReadonlyMap<string, string>,
): Translation {
  const text = renameIn(bundle, renames);
  const before = new Set(freeNames(fixture));
  const unmapped = freeNames(bundle).filter((name) => !renames.has(name));
  return {
    text,
    added: unmapped.filter((name) => !before.has(name)),
    reused: unmapped.filter((name) => before.has(name)),
  };
}

export function methodIn(text: string, name: string): string | undefined {
  const start = text.indexOf(`async ${name}(`);
  if (start === -1) {
    return undefined;
  }
  const open = text.indexOf('){', start) + 1;
  return text.slice(start, blockEnd(text, open) + 1);
}

export function classHeaderIn(text: string, member: string): string | undefined {
  const at = text.indexOf(member);
  const start = [...text.slice(0, at).matchAll(/class [\w$]+\{/gu)].at(-1)?.index;
  const constructor = start === undefined ? -1 : text.indexOf('constructor(', start);
  if (at === -1 || start === undefined || constructor === -1 || constructor > at) {
    return undefined;
  }
  const open = text.indexOf('){', constructor) + 1;
  return text.slice(start, blockEnd(text, open) + 1);
}

export type PieceReading =
  | { kind: 'same' }
  | { kind: 'missing' }
  | { kind: 'changed'; alignment: Alignment; translation: Translation };

export function readPiece(fixture: string, bundle?: string): PieceReading {
  if (bundle === undefined) {
    return { kind: 'missing' };
  }
  const alignment = alignTokens(fixture, bundle);
  if (alignment.hunks.length === 0) {
    return { kind: 'same' };
  }
  return { kind: 'changed', alignment, translation: translate(fixture, bundle, alignment.renames) };
}

export function describePiece(name: string, reading: PieceReading): string[] {
  if (reading.kind === 'same') {
    return [`${name}: same code, names aside`];
  }
  if (reading.kind === 'missing') {
    return [`${name}: not in the bundle any more, renamed or removed upstream`];
  }
  const { alignment, translation } = reading;
  const places = alignment.hunks.length === 1 ? '1 place' : `${alignment.hunks.length} places`;
  const lines = [`${name}: changed upstream in ${places}`];
  for (const [index, hunk] of alignment.hunks.entries()) {
    lines.push(
      `  ${index + 1}. after   ${hunk.before}`,
      `     fixture ${hunk.fixture || '(nothing)'}`,
      `     bundle  ${hunk.bundle || '(nothing)'}`,
    );
  }
  if (translation.added.length > 0) {
    lines.push(
      `  new names ${translation.added.join(' ')}: a new local needs nothing; an outside name needs a stand-in in the harness BINDINGS`,
    );
  }
  if (translation.reused.length > 0) {
    lines.push(
      `  unmapped names ${translation.reused.join(' ')} also appear in the fixture: check each is the same binding`,
    );
  }
  lines.push(
    '  the bundle piece in fixture names, to paste over the old one:',
    `  ${JSON.stringify(translation.text)}`,
  );
  return lines;
}
