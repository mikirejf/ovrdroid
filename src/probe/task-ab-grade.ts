import { escapeRegex } from '../patch/tokens.ts';

export interface Grade {
  pass: boolean;
  reason: string;
}

export interface Outcome {
  reply: string;
  files: Readonly<Record<string, string | undefined>>;
  testExit: number | undefined;
}

export interface CallerExpectation {
  definedIn: string;
  callers: readonly { file: string; calls: number }[];
  decoys: readonly string[];
}

const COUNT_WORDS: ReadonlyMap<string, number> = new Map([
  ['once', 1],
  ['one', 1],
  ['twice', 2],
  ['two', 2],
  ['thrice', 3],
  ['three', 3],
  ['four', 4],
  ['five', 5],
  ['six', 6],
  ['seven', 7],
  ['eight', 8],
  ['nine', 9],
  ['ten', 10],
]);
const COUNT_TOKEN = new RegExp(
  `\\b(\\d+)x?\\b|\\b(${[...COUNT_WORDS.keys()].join('|')})\\b`,
  'giu',
);
const FILE_REFERENCE = /[\w./-]+\.(?:ts|txt|json)(?::\d+(?:-\d+)?)?/gu;
const LINE_NUMBERS = /\blines?\s+\d+(?:\s*(?:[,&\u2013-]|and|to)\s*\d+)*|\bL\d+\b/giu;
const LIST_MARKER = /^\s*(?:\d+[.)]|[-*\u2022])\s+/u;
const HEADING_END = /:[\s*_`]*$/u;
const HEADING_NEGATION =
  /\b(?:not|no|never|without|isn't|aren't|doesn't|don't|non-callers?|exclud\w*|ignor\w*|decoys?|unrelated)\b/iu;
const NEGATION =
  /\b(?:not|no|never|only|without|isn't|doesn't|don't|exclud\w*|ignor\w*|instead|different|decoy|unrelated|string|comment|mention\w*)\b/iu;

function baseName(file: string): string {
  return file.slice(file.lastIndexOf('/') + 1);
}

function mentions(line: string, file: string): boolean {
  return new RegExp(`(?<![\\w-])${escapeRegex(baseName(file))}`, 'u').test(line);
}

function linesNaming(reply: string, file: string): string[] {
  return reply.split('\n').filter((line) => mentions(line, file));
}

export function firstClaimedCount(line: string): number | undefined {
  const claim = line
    .replace(LIST_MARKER, '')
    .replaceAll(FILE_REFERENCE, ' ')
    .replaceAll(LINE_NUMBERS, ' ')
    .matchAll(COUNT_TOKEN)
    .next().value;
  if (claim === undefined) {
    return undefined;
  }
  const [, digits, word] = claim;
  return digits === undefined ? COUNT_WORDS.get((word ?? '').toLowerCase()) : Number(digits);
}

interface Clauses {
  after: string;
  before: string;
}

function clausesAround(line: string, file: string): Clauses[] {
  const mention = new RegExp(`(?<![\\w-])${escapeRegex(baseName(file))}`, 'gu');
  const references = [...line.matchAll(FILE_REFERENCE)].map((match) => ({
    start: match.index,
    end: match.index + match[0].length,
  }));
  return [...line.matchAll(mention)].map((match) => {
    const own = references.find(({ start, end }) => start <= match.index && match.index < end);
    const start = own?.start ?? match.index;
    const end = own?.end ?? match.index + match[0].length;
    const previous = references.findLast((reference) => reference.end <= start);
    const next = references.find((reference) => reference.start >= end);
    return {
      after: line.slice(end, next?.start ?? line.length),
      before: line.slice(previous?.end ?? 0, start),
    };
  });
}

function firstClaim(clauses: readonly string[]): number | undefined {
  return clauses.map((clause) => firstClaimedCount(clause)).find((claim) => claim !== undefined);
}

function countsLeadFiles(line: string): boolean {
  const last = [...line.matchAll(FILE_REFERENCE)].at(-1);
  return (
    last !== undefined && firstClaimedCount(line.slice(last.index + last[0].length)) === undefined
  );
}

function claimedCalls(reply: string, file: string): number | undefined {
  const lines = reply.split('\n');
  for (const [at, line] of lines.entries()) {
    const clauses = clausesAround(line, file);
    if (clauses.length === 0) {
      continue;
    }
    const after = clauses.map((clause) => clause.after);
    const before = clauses.map((clause) => clause.before);
    const [near, far] = countsLeadFiles(line) ? [before, after] : [after, before];
    const claim = firstClaim(near) ?? firstClaim(far) ?? firstClaimedCount(lines[at + 1] ?? '');
    if (claim !== undefined) {
      return claim;
    }
  }
  return undefined;
}

function isHeading(line: string): boolean {
  return !LIST_MARKER.test(line) && HEADING_END.test(line);
}

function underNegatedHeading(lines: readonly string[], at: number): boolean {
  for (let above = at - 1; above >= 0; above--) {
    const line = lines[above] ?? '';
    if (line.trim() !== '' && !LIST_MARKER.test(line)) {
      return isHeading(line) && HEADING_NEGATION.test(line);
    }
  }
  return false;
}

function namedAsCaller(reply: string, decoy: string): boolean {
  const lines = reply.split('\n');
  return lines.some(
    (line, at) => mentions(line, decoy) && !NEGATION.test(line) && !underNegatedHeading(lines, at),
  );
}

function summed(problems: readonly string[], pass: string): Grade {
  return problems.length === 0
    ? { pass: true, reason: pass }
    : { pass: false, reason: problems.join('; ') };
}

export function gradeChain(reply: string, code: string): Grade {
  const given = new RegExp(`(?<!\\d)${escapeRegex(code)}(?!\\d)`, 'u').test(reply);
  return given
    ? { pass: true, reason: `gave the code ${code}` }
    : { pass: false, reason: `the reply never gives the code ${code}` };
}

export function gradeCallers(reply: string, expected: CallerExpectation): Grade {
  const problems: string[] = [];
  if (linesNaming(reply, expected.definedIn).length === 0) {
    problems.push(`never names ${expected.definedIn} as the definition`);
  }
  for (const { file, calls } of expected.callers) {
    if (linesNaming(reply, file).length === 0) {
      problems.push(`never names caller ${file}`);
      continue;
    }
    const claimed = claimedCalls(reply, file);
    if (claimed !== calls) {
      problems.push(`${file} calls it ${calls} times, the reply says ${claimed ?? 'no count'}`);
    }
  }
  for (const decoy of expected.decoys) {
    if (namedAsCaller(reply, decoy)) {
      problems.push(`names ${decoy} as a caller, but it does not call the function`);
    }
  }
  return summed(
    problems,
    `named the definition and all ${expected.callers.length} callers with the right counts, and no decoy`,
  );
}

export function gradeExplore(reply: string, files: readonly string[], port: number): Grade {
  const missing = files.filter((file) => linesNaming(reply, file).length === 0);
  const problems = missing.length === 0 ? [] : [`never names ${missing.join(', ')}`];
  if (!new RegExp(String.raw`\b${port}\b`, 'u').test(reply)) {
    problems.push(`never states the default port ${port}`);
  }
  return summed(
    problems,
    `named all ${files.length} implementing files and the default port ${port}`,
  );
}

export function gradeFix(outcome: Outcome, testFile: string, original: string): Grade {
  const problems: string[] = [];
  if (outcome.files[testFile] !== original) {
    problems.push(`${testFile} was changed or deleted`);
  }
  if (outcome.testExit !== 0) {
    problems.push(`the tests still fail (bun test exit ${outcome.testExit ?? 'none'})`);
  }
  return summed(problems, 'the tests pass and the test file is untouched');
}
