import type { App } from '../../binary/graph.ts';
import { blockEnd } from '../tokens.ts';
import { moduleHolding, sourceApp, textOf } from './ink-frame-harness.ts';
import { closureOf } from './module-closure.ts';
import type { Stand } from './session-mention-harness.ts';
import type { Plain } from './stream-render-harness.ts';
import {
  evaluateProgram,
  guarded,
  importedValue,
  patchedApp,
  rebased,
} from './stream-render-harness.ts';

export interface Tree {
  children: unknown[];
}

export interface Parsed {
  root: Tree;
  unfinishedDisplayLine?: number;
}

export interface Markdown {
  parse: (input: string) => Parsed;
  cuts: (content: string, cuts: number[]) => number[];
  parses: () => number;
}

export interface MarkdownOptions {
  guardResults?: boolean;
  throwOn?: string;
}

type Parser = (source: string, options: Stand) => Stand;

const MATH_EXTENSION = /function [\w$]+\(\)\{return\{enter:\{mathFlow:/u;
const JSON_RENDER_TAGS = /var [\w$]+="<json-render",[\w$]+="<\/json-render>";/u;
const PARSE_FUNCTION = /function (?<name>[\w$]+)\([\w$]+\)\{let(?:\{completedOffsets:| \$ODmemo=)/u;
const CUT_FUNCTION = /function (?<name>[\w$]+)\([\w$]+,[\w$]+\)\{let [\w$]+=[\w$]+\.length>0\?/u;
const PARSER_CALL = /unfinishedDisplayOffset:[\w$]+\}=[\w$]+\([\w$]+\),[\w$]+=(?<name>[\w$]+)\(/u;
const GUARD_RESULT = /let \$ODresult=\$ODparse\((?<input>\w+)\)/u;

function isParser(value: Stand): value is Parser {
  return typeof value === 'function';
}

function matched(text: string, pattern: RegExp): string {
  const found = pattern.exec(text)?.groups?.['name'];
  if (found === undefined) {
    throw new Error(`${pattern.source} matches nothing in the module`);
  }
  return found;
}

function indexOfPattern(text: string, pattern: RegExp): number {
  const found = pattern.exec(text);
  if (found === null) {
    throw new Error(`${pattern.source} matches nothing in the module`);
  }
  return found.index;
}

function functionEnd(text: string, name: string): number {
  const open = text.indexOf(`function ${name}(`);
  if (open === -1) {
    throw new Error(`function ${name} is missing`);
  }
  return blockEnd(text, text.indexOf('{', open)) + 1;
}

function markdownIn(text: string, options: MarkdownOptions): Markdown {
  const parseName = matched(text, PARSE_FUNCTION);
  const lastName = text.includes('function $ODparse(') ? '$ODparse' : parseName;
  const cutName = matched(text, CUT_FUNCTION);
  const parserName = matched(text, PARSER_CALL);
  const real = importedValue(text, parserName);
  if (!isParser(real)) {
    throw new TypeError('the markdown parser is not a function');
  }
  let parses = 0;
  const counting: Parser = (source, parseOptions) => {
    parses += 1;
    if (options.throwOn !== undefined && source.includes(options.throwOn)) {
      throw new Error('parser failure');
    }
    return real(source, parseOptions);
  };
  let math = text.slice(indexOfPattern(text, MATH_EXTENSION), functionEnd(text, lastName));
  if (options.guardResults === true) {
    math = math.replace(GUARD_RESULT, 'let $ODresult=$ODguard($ODparse($<input>))');
  }
  const cutsStart = indexOfPattern(text, JSON_RENDER_TAGS);
  const code = evaluateProgram<{ parse: Markdown['parse']; cuts: Markdown['cuts'] }>({
    moduleText: text,
    source: `${math};${text.slice(cutsStart, functionEnd(text, cutName))}`,
    returns: [`parse:${parseName}`, `cuts:${cutName}`],
    overrides: new Map<string, Stand>([
      [parserName, counting],
      ['$ODguard', guarded],
    ]),
  });
  return { ...code, parses: () => parses };
}

function markdownModule(app: App): string {
  return textOf(app, moduleHolding(sourceApp(), rebased('markdown-parse-memo').find));
}

export function stockMarkdown(options: MarkdownOptions = {}): Markdown {
  return markdownIn(markdownModule(sourceApp()), options);
}

export function patchedMarkdown(options: MarkdownOptions = {}): Markdown {
  return markdownIn(markdownModule(patchedApp()), options);
}

export interface Size {
  width: number;
  height: number;
}

export interface Area {
  x1?: number;
  x2?: number;
  y1?: number;
  y2?: number;
}

export interface Cell {
  [key: string]: Plain;
  type: string;
  value: string;
  fullWidth: boolean;
  styles: Plain[];
}

export type Transformer = (line: string, index: number) => string;

export type WriteArguments = [x: number, y: number, text: string, options: WriteOptions];

export interface WriteOptions {
  transformers: Transformer[];
}

export interface Grid {
  write: (...args: WriteArguments) => void;
  clip: (area: Area) => void;
  unclip: () => void;
  get: () => { output: string; height: number };
}

export type GridClass = new (size: Size) => Grid;

export interface GridOptions {
  blank?: (cell: Cell) => Cell;
}

const GRID_CLASS = /class (?<name>[\w$]+)\{operations=\[\];caches=new [\w$]+;width;height;/u;
const BLANK = '{type:"char",value:" ",fullWidth:!1,styles:[]}';

function gridIn(text: string, options: GridOptions): GridClass {
  const className = matched(text, GRID_CLASS);
  let source = closureOf(text, [className]);
  if (options.blank !== undefined) {
    source = source.replace(`$ODblank=${BLANK}`, `$ODblank=$ODmake(${BLANK})`);
  }
  const loaded = evaluateProgram<Record<string, GridClass>>({
    moduleText: text,
    source,
    returns: [className],
    overrides: new Map<string, Stand>([['$ODmake', options.blank]]),
  })[className];
  if (loaded === undefined) {
    throw new Error('the Output class did not load');
  }
  return loaded;
}

function gridModule(app: App): string {
  return textOf(app, moduleHolding(sourceApp(), BLANK));
}

export function stockGrid(): GridClass {
  return gridIn(gridModule(sourceApp()), {});
}

export function patchedGrid(options: GridOptions = {}): GridClass {
  return gridIn(gridModule(patchedApp()), options);
}
