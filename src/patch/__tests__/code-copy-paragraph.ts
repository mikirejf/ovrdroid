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

interface RenderContext {
  config: { maxWidth: number; colors: Record<string, string> };
}

interface TextProps {
  children: string;
}

interface TextElement {
  props: TextProps;
}

type Renderer = (children: MarkdownNode[], context: RenderContext, key: string) => TextElement;

interface LineBuilder {
  VH: Stand;
  rt: Stand;
}

export interface Paragraphs {
  stock: string[];
  patched: string[];
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

function paragraphLines(app: App, markdown: MarkdownNode[], width: number): string[] {
  const context = { config: { maxWidth: width, colors: MARKDOWN_COLORS } };
  return rendererIn(app)(markdown, context, 'paragraph').props.children.split('\n');
}

export function inlineCodeParagraph(command: string, width: number): Paragraphs {
  const markdown: MarkdownNode[] = [
    { type: 'text', value: 'You run ' },
    { type: 'inlineCode', value: command },
    { type: 'text', value: '.' },
  ];
  return {
    stock: paragraphLines(sourceApp(), markdown, width),
    patched: paragraphLines(patchSource(sourceApp(), codeCopyPatches), markdown, width),
  };
}
