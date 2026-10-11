import { patchSource } from '../../binary/apply.ts';
import type { App } from '../../binary/graph.ts';
import { highlightPatches } from '../highlight-patches.ts';
import type { Rebase } from '../rebase.ts';
import { rebaseAll } from '../rebase.ts';
import { moduleHolding, renamed, sourceApp, STOCK, textOf } from './ink-frame-harness.ts';
import { payloadFunction } from './payload.ts';
import type { Stand } from './session-mention-harness.ts';
import { evaluateProgram, importedValue } from './stream-render-harness.ts';

export interface Highlighter {
  highlight: (code: string, language: string | undefined) => string;
  ansi: (html: string) => string;
  diffLine: (code: string, language?: string) => string;
  highlights: () => number;
  colorings: () => number;
}

interface Hljs {
  highlight: (code: string, options: Stand) => Stand;
}

type ThemeName = 'dark' | 'light';

const SYNTAX_COLORS: Record<ThemeName, Record<string, string>> = {
  dark: {
    'hljs-keyword': '#afafff',
    'hljs-string': '#00d75f',
    'hljs-number': '#ffaf00',
    'hljs-title': '#5fafd7',
    'hljs-comment': '#767676',
    'hljs-attr': '#d75f5f',
  },
  light: {
    'hljs-keyword': '#7b1fa2',
    'hljs-string': '#2e7d32',
    'hljs-number': '#c62828',
    'hljs-title': '#0057a8',
    'hljs-comment': '#8a8a8a',
    'hljs-attr': '#6a1b9a',
  },
};

export const TRUE_COLOR = 3;
export const NO_COLOR = 0;

export const terminal = { level: TRUE_COLOR };

interface Palette {
  active: ThemeName;
  use: (name: ThemeName) => void;
}

export const palette: Palette = {
  active: 'dark',
  use: (name) => {
    palette.active = name;
  },
};

const rebases = rebaseAll(
  highlightPatches,
  (STOCK ?? []).map((module) => module.text),
);

const DIFF_LINE = /function (?<name>\w+)\(\w+,\w+\)\{if\(!\w+\)return \w+;let \w+=\w+\(\w+,\w+\);/u;
const THEME_MANAGER = /\w+=\(\)=>(?<name>\w+)\(\)\.getSyntaxColors\(\)/u;
const REQUIRE_CALL = /import\.meta\.require\(/gu;
const HIGHLIGHT_CHUNK = /import\.meta\.require\("(?<chunk>[^"]+)"\)/u;
const HELPER_IMPORT = /import\{(?<first>\w+),(?<second>\w+)\}from"[^"]+";/u;
const DEFAULT_EXPORT = /export\{(?<local>\w+) as default\};/u;

export function rebased(name: string): Rebase {
  const found = rebases.find((rebase) => rebase.name === name);
  if (found === undefined) {
    throw new Error(`${name} is missing from the highlight patches`);
  }
  return found;
}

export function patchedApp(): App {
  return patchSource(sourceApp(), highlightPatches);
}

function highlightModule(app: App): string {
  return textOf(app, moduleHolding(sourceApp(), rebased('code-highlight-memo').find));
}

function paint(color: string, text: string): string {
  if (terminal.level === NO_COLOR) {
    return text;
  }
  const open = terminal.level === TRUE_COLOR ? `38;2;${color}` : `38;5;${color.length}`;
  return `\u001B[${open}m${text}\u001B[39m`;
}

function loadHighlightJs(chunk: string): Hljs {
  const source = textOf(sourceApp(), chunk);
  const helpers = HELPER_IMPORT.exec(source)?.groups;
  const local = DEFAULT_EXPORT.exec(source)?.groups?.['local'];
  if (helpers === undefined || local === undefined) {
    throw new Error('the highlight.js chunk changed its import or export shape');
  }
  const { first = '', second = '' } = helpers;
  const importLine = HELPER_IMPORT.exec(source)?.[0] ?? '';
  const body = source
    .replace(HELPER_IMPORT, `const{${first},${second}}=$ODhelpers;`)
    .replace(DEFAULT_EXPORT, `return ${local};`);
  const make = payloadFunction<[Record<string, Stand>], Hljs>(['$ODhelpers'], body);
  return make({
    [first]: importedValue(importLine, first),
    [second]: importedValue(importLine, second),
  });
}

function highlighterIn(text: string): Highlighter {
  const chunk = HIGHLIGHT_CHUNK.exec(text)?.groups?.['chunk'];
  const diffName = DIFF_LINE.exec(text)?.groups?.['name'];
  const themeName = THEME_MANAGER.exec(text)?.groups?.['name'];
  if (chunk === undefined || diffName === undefined || themeName === undefined) {
    throw new Error('the module no longer holds the highlight functions');
  }
  const real = loadHighlightJs(chunk);
  let highlights = 0;
  let colorings = 0;
  const hljs = {
    highlight: (code: string, options: Stand) => {
      highlights += 1;
      return real.highlight(code, options);
    },
  };
  const chalk = {
    get level() {
      return terminal.level;
    },
    hex: (color: string) => {
      colorings += 1;
      return (span: string) => paint(color, span);
    },
  };
  const themes = { getSyntaxColors: () => SYNTAX_COLORS[palette.active] };
  const start = text.indexOf('function ho(');
  const code = evaluateProgram<Pick<Highlighter, 'highlight' | 'ansi' | 'diffLine'>>({
    moduleText: text,
    source: text
      .slice(start, text.indexOf('export{', start))
      .replaceAll(REQUIRE_CALL, '$ODrequire('),
    returns: [
      `highlight:${renamed(rebased('code-highlight-memo'), 'y')}`,
      `ansi:${renamed(rebased('code-ansi-memo'), 'S')}`,
      `diffLine:${diffName}`,
    ],
    overrides: new Map<string, Stand>([
      ['$ODrequire', () => ({ default: hljs })],
      [renamed(rebased('code-ansi-memo'), 'V'), chalk],
      [themeName, () => themes],
    ]),
  });
  return { ...code, highlights: () => highlights, colorings: () => colorings };
}

export function stockHighlighter(): Highlighter {
  return highlighterIn(highlightModule(sourceApp()));
}

export function patchedHighlighter(): Highlighter {
  return highlighterIn(highlightModule(patchedApp()));
}
