import { patchSource } from '../../binary/apply.ts';
import type { App } from '../../binary/graph.ts';
import { codeCopyPatches } from '../code-copy-patches.ts';
import { moduleHolding, sourceApp, textOf } from './ink-frame-harness.ts';
import { closureOf } from './module-closure.ts';
import type { Stand } from './session-mention-harness.ts';
import { evaluateProgram } from './stream-render-harness.ts';

const INLINE_CODE = 'case"inlineCode":f.segment(rt(F.value,';
const WRAP_WORDS = 'function z(n){return/\\s/.test(n.text)}';
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
  VH: Stand;
  rt: Stand;
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

function lineBuilderIn(app: App): LineBuilder {
  const text = textOf(app, moduleHolding(sourceApp(), WRAP_WORDS));
  return evaluateProgram<LineBuilder>({
    moduleText: text,
    source: closureOf(text, ['VH', 'rt']),
    returns: ['VH', 'rt'],
    overrides: new Map<string, Stand>([['X', uncolored()]]),
  });
}

function textElement(_type: Stand, props: TextProps): TextElement {
  return { props };
}

function rendererIn(app: App): Renderer {
  const text = textOf(app, moduleHolding(sourceApp(), INLINE_CODE));
  const { VH, rt } = lineBuilderIn(app);
  return evaluateProgram<{ tS: Renderer }>({
    moduleText: text,
    source: closureOf(text, ['tS']),
    returns: ['tS'],
    overrides: new Map<string, Stand>([
      ['t', textElement],
      ['o', null],
      ['VH', VH],
      ['rt', rt],
    ]),
  }).tS;
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
