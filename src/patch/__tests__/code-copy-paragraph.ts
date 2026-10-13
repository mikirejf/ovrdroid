import { patchSource } from '../../binary/apply.ts';
import type { App } from '../../binary/graph.ts';
import { codeCopyPatches } from '../code-copy-patches.ts';
import type { Rebase } from '../rebase.ts';
import { rebaseAll } from '../rebase.ts';
import { moduleHolding, sourceApp, STOCK, textOf } from './ink-frame-harness.ts';
import { closureOf } from './module-closure.ts';
import { rebasedNamed } from './payload.ts';
import type { Stand } from './session-mention-harness.ts';
import { evaluateProgram } from './stream-render-harness.ts';

const rebases: Rebase[] = rebaseAll(
  codeCopyPatches,
  (STOCK ?? []).map((module) => module.text),
);

const ID = String.raw`[\w$]+`;
const COLOR_LOOKUP = new RegExp(
  String.raw`let ${ID}=(?<paint>${ID});if\(${ID}\.color\)switch\(`,
  'u',
);
const MARKDOWN_COLORS = { code: 'gray', bold: 'yellow', italic: 'green', link: 'cyan' };

interface MarkdownNode {
  type: string;
  value: string;
}

interface RenderConfig {
  maxWidth: number;
  colors: Record<string, string>;
  unwrapCode: boolean;
}

interface RenderContext {
  config: RenderConfig;
}

interface TextProps {
  children: string;
  wrap?: string;
}

interface TextElement {
  props: TextProps;
}

type Renderer = (children: MarkdownNode[], context: RenderContext, key: string) => TextElement;

interface LineBuilder {
  entry: Stand;
  segment: Stand;
}

export interface Paragraph {
  lines: string[];
  wrap: string | undefined;
}

export interface Paragraphs {
  stock: Paragraph;
  patched: Paragraph;
}

function uncolored(): StringConstructor {
  const paint: StringConstructor = new Proxy(String, { get: () => paint });
  return paint;
}

function stockName(rebase: Rebase, written: string): string {
  return rebase.renames[written] ?? written;
}

function required(value: string | undefined, what: string): string {
  if (value === undefined) {
    throw new Error(`stock has no ${what}`);
  }
  return value;
}

function escaped(name: string): string {
  return name.replaceAll('$', String.raw`\$`);
}

function lineBuilderIn(app: App): LineBuilder {
  const wordsRebase = rebasedNamed(rebases, 'code-copy-no-break-space-joins-words');
  const entry = stockName(rebasedNamed(rebases, 'code-copy-long-word-entry'), 'VH');
  const segment = stockName(rebasedNamed(rebases, 'code-copy-inline-code-joined'), 'rt');
  const text = textOf(app, moduleHolding(sourceApp(), wordsRebase.find));
  const paint = required(COLOR_LOOKUP.exec(text)?.groups?.['paint'], 'color lookup in the wrapper');
  const built = evaluateProgram<Record<string, Stand>>({
    moduleText: text,
    source: closureOf(text, [entry, segment]),
    returns: [entry, segment],
    overrides: new Map<string, Stand>([[paint, uncolored()]]),
  });
  return { entry: built[entry], segment: built[segment] };
}

function textElement(_type: Stand, props: TextProps): TextElement {
  return { props };
}

function rendererIn(app: App): Renderer {
  const segmentRebase = rebasedNamed(rebases, 'code-copy-inline-code-joined');
  const paragraphRebase = rebasedNamed(rebases, 'code-copy-paragraph-text-unwrapped');
  const text = textOf(app, moduleHolding(sourceApp(), segmentRebase.find));
  const paragraph = stockName(paragraphRebase, 'Ik');
  const flow = new RegExp(
    String.raw`function (?<flow>${ID})\(${ID},${ID},${ID},${ID}=\{\}\)\{let ${ID}=new ${ID}\(!0\);return ${ID}\(${ID},${ID},${ID},${ID}\),${escaped(paragraph)}\(`,
    'u',
  );
  const name = required(flow.exec(text)?.groups?.['flow'], 'inline flow renderer');
  const lines = lineBuilderIn(app);
  const program = evaluateProgram<Record<string, Renderer | undefined>>({
    moduleText: text,
    source: closureOf(text, [name]),
    returns: [name],
    overrides: new Map<string, Stand>([
      [stockName(paragraphRebase, 't'), textElement],
      [stockName(paragraphRebase, 'o'), null],
      [stockName(rebasedNamed(rebases, 'code-copy-long-word-entry'), 'VH'), lines.entry],
      [stockName(segmentRebase, 'rt'), lines.segment],
    ]),
  });
  const renderer = program[name];
  if (renderer === undefined) {
    throw new Error('the inline flow renderer did not evaluate');
  }
  return renderer;
}

function paragraphIn(app: App, markdown: MarkdownNode[], config: RenderConfig): Paragraph {
  const { children, wrap } = rendererIn(app)(markdown, { config }, 'paragraph').props;
  return { lines: children.split('\n'), wrap };
}

export interface ParagraphOptions {
  unwrapCode?: boolean;
  tail?: string;
}

export function inlineCodeParagraph(
  command: string,
  width: number,
  { unwrapCode = true, tail = '.' }: ParagraphOptions = {},
): Paragraphs {
  const markdown: MarkdownNode[] = [
    { type: 'text', value: 'You run ' },
    { type: 'inlineCode', value: command },
    { type: 'text', value: tail },
  ];
  const config = { maxWidth: width, colors: MARKDOWN_COLORS, unwrapCode };
  return {
    stock: paragraphIn(sourceApp(), markdown, config),
    patched: paragraphIn(patchSource(sourceApp(), codeCopyPatches), markdown, config),
  };
}
