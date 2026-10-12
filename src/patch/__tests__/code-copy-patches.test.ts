import { describe, expect, test } from 'bun:test';

import { CODE_COPY_GLOBAL, codeCopyPatches, UNWRAP_KEY, UNWRAPPED } from '../code-copy-patches.ts';
import type { Rebase } from '../rebase.ts';
import { applies, rebaseAll } from '../rebase.ts';
import { STOCK } from './ink-frame-harness.ts';
import { describeStrayNames, patchNamed, payloadFunction, rebasedNamed } from './payload.ts';

describeStrayNames(codeCopyPatches);

interface Props {
  children?: Node | Node[] | string;
  value?: string;
  borderLeft?: boolean;
  paddingLeft?: number;
  maxWidth?: number;
  config?: object;
  wrap?: string;
  style?: { textWrap?: string };
}

interface Tag {
  name: string;
}

interface Node {
  type: string | Tag;
  props: Props;
}

function element(type: string | Tag, props: Props): Node {
  return { type, props };
}

function kids(node: Node | undefined): Node[] {
  const children = node?.props.children;
  if (!Array.isArray(children)) {
    throw new TypeError('expected a list of children');
  }
  return children;
}

function only(node: Node | undefined): Node {
  const child = node?.props.children;
  if (child === undefined || typeof child === 'string' || Array.isArray(child)) {
    throw new TypeError('expected one child element');
  }
  return child;
}

const BOX = 'Box';
const TEXT = 'Text';
const CODE = element('Highlighted', {});
const PROVIDER = { name: 'wrap provider' };
const COPY_CONFIG = { [UNWRAP_KEY]: true };

function codeBlock(config: { [UNWRAP_KEY]?: boolean }): Node {
  const patch = patchNamed(codeCopyPatches, 'code-copy-block-unwrapped');
  return payloadFunction<unknown[], Node>(
    ['l', 'c', 't', 'o', 'a', 'A', 'D', 'O', 'E', 'bse', 'globalThis'],
    patch.replace.slice(0, -1),
  )(
    element,
    BOX,
    element,
    TEXT,
    { text: { muted: 'grey' } },
    { showCodeLanguage: true, maxWidth: 40, ...config },
    'sh',
    'echo hi',
    'block-key',
    () => CODE,
    { [CODE_COPY_GLOBAL]: { wrap: { Provider: PROVIDER } } },
  );
}

describe('the code block in the transcript', () => {
  const block = codeBlock(COPY_CONFIG);
  const [label, body] = kids(block);

  test('drops the left border and the indent, so a copied line starts with the code', () => {
    expect(block.props.borderLeft).toBeUndefined();
    expect(only(body).props.paddingLeft).toBeUndefined();
  });

  test('tells every Text inside it not to wrap, so a long line reaches the terminal whole', () => {
    expect(body?.type).toBe(PROVIDER);
    expect(body?.props.value).toBe(UNWRAPPED);
    expect(only(only(body))).toBe(CODE);
  });

  test('keeps the language label line', () => {
    expect(only(label).props.children).toBe('sh');
  });
});

describe('a code block anywhere else', () => {
  const block = codeBlock({});
  const [, body] = kids(block);

  test('keeps the stock border, indent and wrapping', () => {
    expect(block.props.borderLeft).toBe(true);
    expect(body?.type).toBe(BOX);
    expect(body?.props.paddingLeft).toBe(2);
    expect(only(body)).toBe(CODE);
  });
});

describe('the transcript message', () => {
  test('hands the markdown renderer the shared config that switches the flat code block on', () => {
    const patch = patchNamed(codeCopyPatches, 'code-copy-transcript-markdown');
    const node = payloadFunction<unknown[], Node>(
      ['f', 't', 'Da', 'y', 'a', 'q', 'Q', 'globalThis'],
      `return ${patch.replace}:null`,
    )(
      { messageType: 'markdown', role: 'assistant' },
      element,
      'Markdown',
      60,
      { markdown: { heading: 'green' }, toolName: 'blue' },
      'white',
      'text',
      { [CODE_COPY_GLOBAL]: { config: COPY_CONFIG } },
    );
    expect(node.props.config).toBe(COPY_CONFIG);
    expect(node.props.maxWidth).toBe(60);
  });
});

interface Context {
  initial: unknown;
  Provider: object;
}

interface Shared {
  [CODE_COPY_GLOBAL]?: { wrap: Context };
}

interface TextRun {
  textWrap: string | undefined;
  hooks: number;
}

const rebases: Rebase[] = rebaseAll(
  codeCopyPatches,
  (STOCK ?? []).map((module) => module.text),
);

function functionTail(text: string, from: number): string {
  let depth = 1;
  let quote: string | undefined;
  for (let at = from; at < text.length; at++) {
    const char = text[at];
    if (quote !== undefined) {
      if (char === '\\') {
        at += 1;
      } else if (char === quote) {
        quote = undefined;
      }
    } else if (char === '"' || char === "'" || char === '`') {
      quote = char;
    } else if (char === '{') {
      depth += 1;
    } else if (char === '}') {
      depth -= 1;
      if (depth === 0) {
        return text.slice(from, at + 1);
      }
    }
  }
  throw new Error('the Text component never closes');
}

function patchedText(): (props: Props, provided?: string) => TextRun {
  const rebase = rebasedNamed(rebases, 'code-copy-text-wrap-context');
  const module = (STOCK ?? []).find((entry) => entry.text.includes(rebase.find));
  if (module === undefined) {
    throw new Error('no module carries the Text component');
  }
  const at = module.text.indexOf(rebase.find) + rebase.find.length;
  const source = rebase.replace + functionTail(module.text, at);
  const name = (written: string): string => rebase.renames[written] ?? written;
  const screenReader: Context = { initial: { isScreenReaderEnabled: false }, Provider: {} };
  const background: Context = { initial: undefined, Provider: {} };
  const shared: Shared = {};
  let provided: string | undefined;
  let hooks = 0;
  const text = payloadFunction<unknown[], (props: Props) => Node>(
    [name('Ct'), name('Be'), name('Wn'), name('Dg'), name('sn'), 'globalThis'],
    `${source};return ${name('o')}`,
  )(
    (initial: unknown): Context => ({ initial, Provider: {} }),
    (context: Context) => {
      hooks += 1;
      return context === shared[CODE_COPY_GLOBAL]?.wrap && provided !== undefined
        ? provided
        : context.initial;
    },
    screenReader,
    background,
    element,
    shared,
  );
  return (props, wrap) => {
    provided = wrap;
    hooks = 0;
    const node = text({ children: 'echo hi', ...props });
    return { textWrap: node.props.style?.textWrap, hooks };
  };
}

describe.skipIf(STOCK === undefined)('the patched Text component', () => {
  test.each(codeCopyPatches.map((patch) => [patch.name] as const))(
    '%s applies to the shipped bundle once',
    (name) => {
      const rebase = rebasedNamed(rebases, name);
      expect(applies(rebase)).toBe(true);
      expect(rebase.matches).toBe(1);
    },
  );

  test('wraps as before outside a code block', () => {
    expect(patchedText()({}).textWrap).toBe('wrap');
  });

  test('takes the unwrapped mode from a code block around it', () => {
    expect(patchedText()({}, UNWRAPPED).textWrap).toBe(UNWRAPPED);
  });

  test('keeps a wrap mode its caller set', () => {
    expect(patchedText()({ wrap: 'truncate-end' }, UNWRAPPED).textWrap).toBe('truncate-end');
  });

  test('calls the same hooks whether or not the caller set a wrap mode', () => {
    const text = patchedText();
    expect(text({ wrap: 'truncate-end' }).hooks).toBe(text({}).hooks);
  });
});
