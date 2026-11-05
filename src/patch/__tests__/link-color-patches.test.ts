import { describe, expect, test } from 'bun:test';

import { patchSource } from '../../binary/apply.ts';
import { linkColorPatches } from '../link-color-patches.ts';
import { patches } from '../patches.ts';
import type { Rebase } from '../rebase.ts';
import { applies, rebaseAll } from '../rebase.ts';
import { sourceApp, STOCK } from './ink-frame-harness.ts';
import { describeStrayNames, payloadFunction } from './payload.ts';

const SLOW_PATCH_MS = 120_000;
const BODY = '#body';
const LINK = '#link';
const BOLD = '#bold';

const rebases = rebaseAll(
  linkColorPatches,
  (STOCK ?? []).map((module) => module.text),
);

function rebased(): Rebase {
  const found = rebases.find((rebase) => rebase.name === 'markdown-link-color');
  if (found === undefined) {
    throw new Error('markdown-link-color is missing from the link color patches');
  }
  return found;
}

describeStrayNames(linkColorPatches);

describe.skipIf(STOCK === undefined)(
  'markdown-link-color applies to the shipped bundle once',
  () => {
    test('it matches once', () => {
      const rebase = rebased();
      expect(applies(rebase)).toBe(true);
      expect(rebase.matches).toBe(1);
    });

    test(
      'it ships and applies on top of every other shipped patch',
      () => {
        expect(patches.filter((patch) => patch.name === 'markdown-link-color')).toHaveLength(1);
        const shipped = patchSource(sourceApp(), patches)
          .map((module) => module.text)
          .join('\n');
        expect(shipped.split(rebased().replace)).toHaveLength(2);
        expect(shipped).not.toContain(rebased().find);
      },
      SLOW_PATCH_MS,
    );
  },
);

interface Style {
  color?: string;
  bold?: boolean;
  italic?: boolean;
}

interface Segment {
  text: string;
  style: Style;
}

interface Node {
  type: string;
  value?: string;
  url?: string;
  children?: Node[];
}

interface Context {
  parentColor: string;
  config: { colors: Record<string, string> };
  definitions: Map<string, { url: string }>;
  terminalLinksSupported: boolean;
}

interface Builder {
  current: Segment[];
}

type Render = (nodes: Node[]) => Segment[];

function renderFrom(inlineSource: string): Render {
  const { renames } = rebased();
  const named = (name: string): string => renames[name] ?? name;
  const stubs = ['Rt', 'ys', 'qd', 'j8', 'UJ', 'EI'].map((name) => named(name));
  const builder = named('nC');
  const inline = named('rC');
  const make = payloadFunction<
    [
      (value: string, style: Style) => Segment,
      (color: string, style: Style) => Style,
      (url: string) => string,
      () => null,
      (segments: Segment[]) => string,
      () => null,
    ],
    (nodes: Node[], context: Context) => Builder
  >(
    stubs,
    `${inlineSource}return (nodes,context)=>{let b=new ${builder}(!0);${inline}(b,nodes,context,{});return b}`,
  );
  const run = make(
    (value, style) => ({ text: value, style }),
    (color, style) => ({ ...style, color }),
    (url) => url,
    () => null,
    (segments) => segments.map((segment) => segment.text).join(''),
    () => null,
  );
  const context: Context = {
    parentColor: BODY,
    config: { colors: { link: LINK, bold: BOLD, italic: '#italic', strikethrough: '#strike' } },
    definitions: new Map(),
    terminalLinksSupported: false,
  };
  return (nodes) => run(nodes, context).current;
}

function inlineSourceOf(module: string): string {
  const { renames } = rebased();
  const builder = renames['nC'] ?? 'nC';
  const start = module.indexOf(`class ${builder}{`);
  const end = module.indexOf('function Yy(', start);
  if (start === -1 || end === -1) {
    throw new Error('the inline renderer is missing from the module');
  }
  return module.slice(start, end);
}

function moduleSource(replacement: boolean): string {
  const rebase = rebased();
  const holder = (STOCK ?? []).find((entry) => entry.text.includes(rebase.find));
  if (holder === undefined) {
    throw new Error('no module carries the link renderer');
  }
  return inlineSourceOf(
    replacement ? holder.text.replace(rebase.find, () => rebase.replace) : holder.text,
  );
}

function plain(value: string): Node {
  return { type: 'text', value };
}

function link(children: Node[]): Node {
  return { type: 'link', url: 'https://example.test/page', children };
}

function colorsOf(segments: Segment[]): Record<string, string | undefined> {
  return Object.fromEntries(segments.map((segment) => [segment.text, segment.style.color]));
}

describe.skipIf(STOCK === undefined)('markdown-link-color', () => {
  const stock = renderFrom(moduleSource(false));
  const patched = renderFrom(moduleSource(true));

  test('stock draws the link label in the body colour', () => {
    expect(colorsOf(stock([link([plain('label')])]))['label']).toBe(BODY);
  });

  test('the link label carries the link colour', () => {
    expect(colorsOf(patched([link([plain('label')])]))['label']).toBe(LINK);
  });

  test('bold and plain children of a link both carry the link colour', () => {
    const colors = colorsOf(
      patched([link([{ type: 'strong', children: [plain('bold')] }, plain(' text')])]),
    );
    expect(colors['bold']).toBe(LINK);
    expect(colors[' text']).toBe(LINK);
  });

  test('the url suffix carries the link colour', () => {
    expect(colorsOf(patched([link([plain('label')])]))[' (https://example.test/page)']).toBe(LINK);
  });

  test('text outside a link keeps the parent colour, bold outside keeps stock behaviour', () => {
    const nodes = [
      plain('before '),
      { type: 'strong', children: [plain('b')] },
      link([plain('l')]),
    ];
    const colors = colorsOf(patched(nodes));
    expect(colors['before ']).toBe(BODY);
    expect(colors['b']).toBe(BODY);
    expect(colors['l']).toBe(LINK);
    expect(colorsOf(stock(nodes))['b']).toBe(BODY);
  });
});
