import {
  moduleHolding,
  patchedApp,
  rebased,
  renamed,
  sourceApp,
  textOf,
} from './ink-frame-harness.ts';
import { closureOf, declarationAround } from './module-closure.ts';
import { evaluateProgram } from './stream-render-harness.ts';

export interface Style {
  code: string;
  endCode: string;
}

export interface Char {
  type: 'char';
  value: string;
  styles: Style[];
}

interface Token {
  type: string;
}

interface Tokenizer {
  cP: (chars: Char[]) => string;
  sP: (tokens: Token[]) => Char[];
  lP: (text: string) => Token[];
  f: (styles: Style[]) => string;
  h: (before: Style[], after: Style[]) => Style[];
}

export interface Tokenizers {
  stockCode: Tokenizer;
  patchedCode: Tokenizer;
}

const TO_CHARS = /function (?<name>\w+)\(\w+\)\{let \w+=\[\],\w+=\[\];for\(let \w+ of \w+\)if\(/u;
const TOKENIZE = /function (?<name>\w+)\(\w+,\w+=Number\.POSITIVE_INFINITY\)/u;

function functionNamed(text: string, pattern: RegExp): string {
  const found = pattern.exec(text)?.groups?.['name'];
  if (found === undefined) {
    throw new Error(`${pattern.source} matches nothing in the Ink module`);
  }
  return found;
}

function loadTokenizer(text: string, names: Record<keyof Tokenizer, string>): Tokenizer {
  return evaluateProgram<Tokenizer>({
    moduleText: text,
    source: closureOf(text, Object.values(names)),
    returns: Object.entries(names).map(([key, name]) => `${key}:${name}`),
    overrides: new Map(),
  });
}

let loaded: Tokenizers | undefined;

export function tokenizers(): Tokenizers {
  const rebase = rebased('ink-style-diff-same-skip');
  const module = moduleHolding(sourceApp(), rebase.find);
  const stock = textOf(sourceApp(), module);
  const names = {
    cP: declarationAround(stock, stock.indexOf(rebase.find)),
    sP: functionNamed(stock, TO_CHARS),
    lP: functionNamed(stock, TOKENIZE),
    f: renamed(rebase, 'f'),
    h: renamed(rebase, 'h'),
  };
  loaded ??= {
    stockCode: loadTokenizer(stock, names),
    patchedCode: loadTokenizer(textOf(patchedApp(), module), names),
  };
  return loaded;
}

export const BOLD: Style = { code: '\u001B[1m', endCode: '\u001B[22m' };
export const RED: Style = { code: '\u001B[31m', endCode: '\u001B[39m' };
export const BLUE_BACKGROUND: Style = { code: '\u001B[44m', endCode: '\u001B[49m' };
export const LINK: Style = { code: '\u001B]8;;http://x\u0007', endCode: '\u001B]8;;\u0007' };
export const ODD_END: Style = { code: '\u001B[31m', endCode: '\u001B[0m' };

const ALPHABET: Style[] = [
  BOLD,
  { code: '\u001B[2m', endCode: '\u001B[22m' },
  RED,
  { code: '\u001B[32m', endCode: '\u001B[39m' },
  BLUE_BACKGROUND,
  { code: '\u001B[38;2;1;2;3m', endCode: '\u001B[39m' },
  LINK,
  ODD_END,
];

export function arraysUpTo(length: number): Style[][] {
  let level: Style[][] = [[]];
  const all: Style[][] = [[]];
  for (let size = 1; size <= length; size += 1) {
    level = level.flatMap((prefix) => ALPHABET.map((style) => prefix.concat([style])));
    all.push(...level);
  }
  return all;
}

export function sameItemByItem(before: Style[], after: Style[]): boolean {
  return (
    before.length === after.length &&
    before.every((style, index) => {
      const other = after[index];
      return other !== undefined && style.code === other.code && style.endCode === other.endCode;
    })
  );
}

export function copyOf(styles: Style[]): Style[] {
  return structuredClone(styles);
}

function seeded(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state * 1_664_525 + 1_013_904_223) % 4_294_967_296;
    return state / 4_294_967_296;
  };
}

const PIECES = [
  'a',
  'b',
  ' ',
  'é',
  '日',
  '\u001B[1m',
  '\u001B[2m',
  '\u001B[22m',
  '\u001B[31m',
  '\u001B[32m',
  '\u001B[39m',
  '\u001B[0m',
  '\u001B[44m',
  '\u001B[49m',
  '\u001B[38;2;1;2;3m',
  '\u001B[48;5;9m',
  '\u001B[3m',
  '\u001B[23m',
  '\u001B]8;;http://x\u0007',
  '\u001B]8;;\u0007',
];

export function randomTexts(count: number): string[] {
  const next = seeded(7);
  return Array.from({ length: count }, () =>
    Array.from(
      { length: 1 + Math.floor(next() * 40) },
      () => PIECES[Math.floor(next() * PIECES.length)] ?? '',
    ).join(''),
  );
}
