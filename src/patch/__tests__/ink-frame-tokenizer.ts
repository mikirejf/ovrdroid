import type { Rebase } from '../rebase.ts';
import {
  moduleHolding,
  patchedApp,
  rebased,
  renamed,
  sourceApp,
  textOf,
} from './ink-frame-harness.ts';
import { payloadFunction } from './payload.ts';
import type { Stand } from './session-mention-harness.ts';

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

const LEADING_IMPORT = /^\/\/ @bun @bytecode\nimport\{(?<names>[^}]*)\}from"[^"]*";/u;
const TRAILING_EXPORT = /export\{(?<names>[^}]*)\};/u;

function escapePattern(text: string): string {
  return text.replaceAll(/[$.*+?()[\]{}|\\^]/gu, String.raw`\$&`);
}

function exportedAs(body: string, names: readonly string[], declaration: string): string {
  const found = names.find((name) =>
    new RegExp(`function ${escapePattern(name)}${declaration}`, 'u').test(body),
  );
  if (found === undefined) {
    throw new Error('the tokenizer export is not where the tests expect it');
  }
  return found;
}

function loadTokenizer(text: string, rebase: Rebase): Tokenizer {
  const imported = LEADING_IMPORT.exec(text)?.groups?.['names']?.split(',') ?? [];
  const exported = TRAILING_EXPORT.exec(text)?.groups?.['names']?.split(',') ?? [];
  const body = text.replace(LEADING_IMPORT, '').replace(TRAILING_EXPORT, '');
  const cP = exportedAs(body, exported, String.raw`\(\w+\)\{let \w+="";for`);
  const sP = exportedAs(body, exported, String.raw`\(\w+\)\{let \w+=\[\],\w+=\[\];for`);
  const lP = exportedAs(body, exported, String.raw`\(\w+,\w+=Number\.POSITIVE_INFINITY\)`);
  const f = renamed(rebase, 'f');
  const h = renamed(rebase, 'h');
  const load = payloadFunction<Stand[], Tokenizer>(
    imported,
    `${body};return {cP:${cP},sP:${sP},lP:${lP},f:${f},h:${h}}`,
  );
  return load(...imported.map(() => () => false));
}

let loaded: Tokenizers | undefined;

export function tokenizers(): Tokenizers {
  const rebase = rebased('ink-style-diff-same-skip');
  const name = moduleHolding(sourceApp(), rebase.find);
  loaded ??= {
    stockCode: loadTokenizer(textOf(sourceApp(), name), rebase),
    patchedCode: loadTokenizer(textOf(patchedApp(), name), rebase),
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
