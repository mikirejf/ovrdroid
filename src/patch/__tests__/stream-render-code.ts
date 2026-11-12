import { isBuiltin } from 'node:module';

import { parse as parseJavaScript } from '@babel/parser';
import traverse from '@babel/traverse';

import type { App } from '../../binary/graph.ts';
import { blockEnd } from '../tokens.ts';
import { moduleHolding, sourceApp, textOf } from './ink-frame-harness.ts';
import { closureOf } from './module-closure.ts';
import type { Stand } from './session-mention-harness.ts';
import type { Plain } from './stream-render-harness.ts';
import {
  builtinValue,
  closureValue,
  evaluateProgram,
  guarded,
  importBindings,
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
const CUT_FUNCTION =
  /function (?<name>[\w$]+)\((?<content>[\w$]+),(?<prior>[\w$]+)\)\{let (?<last>[\w$]+)=\k<prior>\.length>0\?\k<prior>\[\k<prior>\.length-1\]:0;if\(\k<last>>=\k<content>\.length\)return\[\.\.\.\k<prior>\];/u;
const CUT_PARSE_CALL = /\{root:[\w$]+,unfinishedDisplayOffset:[\w$]+\}=(?<name>[\w$]+)\(/u;
const CUTS_ANCHOR = '="<json-render",';
const PARSER_CALL = /unfinishedDisplayOffset:[\w$]+\}=[\w$]+\([\w$]+\),[\w$]+=(?<name>[\w$]+)\(/u;
const GUARD_RESULT = /let \$ODresult=\$ODparse\((?<input>\w+)\)/u;

function isParser(value: Stand): value is Parser {
  return typeof value === 'function';
}

function isParse(value: Stand): value is Markdown['parse'] {
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

interface Cuts {
  text: string;
  parseChunk: string;
}

function usesName(source: string, name: string): boolean {
  return new RegExp(`(?<![\\w$.])${name.replaceAll('$', '\\$')}(?![\\w$])`, 'u').test(source);
}

function cutsIn(
  { text, parseChunk }: Cuts,
  parse: Markdown['parse'],
  shared: Record<string, Stand>,
): Markdown['cuts'] {
  const cutName = matched(text, CUT_FUNCTION);
  const cutEnd = functionEnd(text, cutName);
  const parseName = matched(
    text.slice(text.indexOf(`function ${cutName}(`), cutEnd),
    CUT_PARSE_CALL,
  );
  const source = text.slice(indexOfPattern(text, JSON_RENDER_TAGS), cutEnd);
  const imported = [...importBindings(text)].flatMap(([local, { from, exported }]) => {
    if (from === parseChunk) {
      const value = shared[exported];
      return value === undefined ? [] : [[local, value] as const];
    }
    return usesName(source, local) ? [[local, closureValue(from, exported)] as const] : [];
  });
  return evaluateProgram<{ cuts: Markdown['cuts'] }>({
    moduleText: text,
    source,
    returns: [`cuts:${cutName}`],
    overrides: new Map<string, Stand>([...imported, [parseName, parse]]),
  }).cuts;
}

function importsFrom(text: string, module: string): Map<string, string> {
  return new Map(
    [...importBindings(text)].flatMap(([local, binding]) =>
      binding.from === module ? [[local, binding.exported] as const] : [],
    ),
  );
}

function markdownIn(text: string, cuts: Cuts, options: MarkdownOptions): Markdown {
  const parseName = matched(text, PARSE_FUNCTION);
  const lastName = text.includes('function $ODparse(') ? '$ODparse' : parseName;
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
  const names = [parseName, ...importsFrom(cuts.text, cuts.parseChunk).values()].filter((name) =>
    math.includes(`function ${name}(`),
  );
  const shared = evaluateProgram<Record<string, Stand>>({
    moduleText: text,
    source: math,
    returns: names.map((name) => `${JSON.stringify(name)}:${name}`),
    overrides: new Map<string, Stand>([
      [parserName, counting],
      ['$ODguard', guarded],
    ]),
  });
  const parse = shared[parseName];
  if (!isParse(parse)) {
    throw new TypeError('the markdown parse function did not load');
  }
  return { parse, cuts: cutsIn(cuts, parse, shared), parses: () => parses };
}

function parseModule(): string {
  return moduleHolding(sourceApp(), rebased('markdown-parse-memo').find);
}

function cutsModule(): Cuts {
  return {
    text: textOf(sourceApp(), moduleHolding(sourceApp(), CUTS_ANCHOR)),
    parseChunk: parseModule(),
  };
}

export function stockMarkdown(options: MarkdownOptions = {}): Markdown {
  return markdownIn(textOf(sourceApp(), parseModule()), cutsModule(), options);
}

export function patchedMarkdown(options: MarkdownOptions = {}): Markdown {
  return markdownIn(textOf(patchedApp(), parseModule()), cutsModule(), options);
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
  paint: (painter: Painter, box: Box) => void;
  get: () => { output: string; height: number };
}

export interface Box {
  x: number;
  y: number;
}

export type Painter = (cells: Cell[][], box: Box) => void;

interface Span {
  row: number;
  start: number;
  end: number;
}

interface Painters {
  selection: (...args: [cells: Cell[][], box: Box, spans: Span[], color?: string]) => void;
  hover: (
    ...args: [
      cells: Cell[][],
      box: Box,
      target: { spans: Span[]; text?: string; contrastGlyph?: boolean },
      color?: string,
    ]
  ) => void;
}

export type GridClass = new (size: Size) => Grid;

export interface GridOptions {
  blank?: (cell: Cell) => Cell;
}

const GRID_CLASS =
  /class (?<name>[\w$]+)\{operations=\[\];painters=\[\];caches=new [\w$]+;width;height;/u;
const BLANK = '{type:"char",value:" ",fullWidth:!1,styles:[]}';
const SELECTION_PAINTER =
  /function (?<name>[\w$]+)\([\w$]+,[\w$]+,[\w$]+,[\w$]+\)\{let [\w$]+=[\w$]+\([\w$]+\),[\w$]+=new Map;for\(let [\w$]+ of [\w$]+\)\{/u;
const HOVER_PAINTER =
  /function (?<name>[\w$]+)\([\w$]+,[\w$]+,[\w$]+,[\w$]+\)\{let [\w$]+=[\w$]+\([\w$]+\),[\w$]+=new Map;for\(let [\w$]+ of [\w$]+\.spans\)\{/u;

function painterImports(text: string, source: string) {
  const free = new Set<string>();
  traverse(parseJavaScript(source, { sourceType: 'module' }), {
    ReferencedIdentifier(path) {
      if (!path.scope.hasBinding(path.node.name)) {
        free.add(path.node.name);
      }
    },
  });
  return [...importBindings(text)].filter(([name]) => free.has(name));
}

function painterDependency(from: string, exported: string): Stand {
  if (isBuiltin(from)) {
    return builtinValue(from, exported);
  }
  const text = textOf(sourceApp(), from);
  const setLevel = /var (?<name>[\w$]+)=\((?<arg>[\w$]+)\)=>\{[\w$]+\.level=\k<arg>\},/u.exec(text)
    ?.groups?.['name'];
  const source = closureOf(text, setLevel === undefined ? [exported] : [exported, setLevel]);
  const overrides = new Map<string, Stand>();
  for (const [local, binding] of painterImports(text, source)) {
    overrides.set(local, painterDependency(binding.from, binding.exported));
  }
  const result = evaluateProgram<{ value: Stand; setLevel?: (level: number) => void }>({
    moduleText: text,
    source,
    returns: [`value:${exported}`, ...(setLevel === undefined ? [] : [`setLevel:${setLevel}`])],
    overrides,
  });
  result.setLevel?.(3);
  return result.value;
}

export function stockPainters(): Painters {
  const text = textOf(sourceApp(), moduleHolding(sourceApp(), 'contrastGlyph'));
  const selection = matched(text, SELECTION_PAINTER);
  const hover = matched(text, HOVER_PAINTER);
  const source = closureOf(text, [selection, hover]);
  const imported = painterImports(text, source).map(
    ([local, { from, exported }]) => [local, painterDependency(from, exported)] as const,
  );
  return evaluateProgram<Painters>({
    moduleText: text,
    source,
    returns: [`selection:${selection}`, `hover:${hover}`],
    overrides: new Map<string, Stand>(imported),
  });
}

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
