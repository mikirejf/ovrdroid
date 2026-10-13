import { describe, expect, test } from 'bun:test';

import { patchSource } from '../../binary/apply.ts';
import { joinApp } from '../../binary/graph.ts';
import {
  CODE_COPY_GLOBAL,
  codeCopyPatches,
  COPY_PROMPT_LINE,
  NO_BREAK_SPACE,
  UNWRAP_KEY,
  UNWRAPPED,
} from '../code-copy-patches.ts';
import type { Rebase } from '../rebase.ts';
import { applies, rebaseAll } from '../rebase.ts';
import { inlineCodeParagraph } from './code-copy-paragraph.ts';
import { sourceApp, STOCK } from './ink-frame-harness.ts';
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

const INK_TEXT = 'ink-text';

function elementBuilder(source: string): string {
  const call = /(?<builder>[\w$]+)\("ink-text",/u.exec(source)?.groups?.['builder'];
  if (call === undefined) {
    throw new Error('the Text component builds no ink-text element');
  }
  return call;
}

function nested(type: string | Tag, props: Props, ...children: Node[]): Node {
  return children.length === 0 ? { type, props } : { type, props: { ...props, children } };
}

function inkText(node: Node): Node {
  if (node.type === INK_TEXT) {
    return node;
  }
  const [child] = kids(node);
  if (child === undefined) {
    throw new Error('the Text component renders no ink-text element');
  }
  return inkText(child);
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
    [name('Ct'), name('Be'), name('Wn'), name('Dg'), elementBuilder(source), 'globalThis'],
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
    nested,
    shared,
  );
  return (props, wrap) => {
    provided = wrap;
    hooks = 0;
    const node = inkText(text({ children: 'echo hi', ...props }));
    return { textWrap: node.props.style?.textWrap, hooks };
  };
}

const COMMAND = 'git push --no-verify -u origin devkit-run3';

describe.skipIf(STOCK === undefined)('inline code in a paragraph', () => {
  const { stock, patched } = inlineCodeParagraph(COMMAND, 45);

  test('control: stock Droid breaks the command at a space', () => {
    expect(stock.lines.some((line) => line.includes(COMMAND))).toBe(false);
  });

  test('moves the whole command to the next line', () => {
    expect(patched.lines.map((line) => line.trimEnd())).toEqual(['You run', `${COMMAND}.`]);
  });

  test('prints plain spaces, so a copy pastes into a shell', () => {
    expect(patched.lines.join('\n')).not.toContain(NO_BREAK_SPACE);
  });

  test('tells the Text to leave the lines alone', () => {
    expect(patched.wrap).toBe(UNWRAPPED);
  });
});

const LONG_COMMAND =
  'docker run --rm -it -v "$PWD":/work -w /work -e TOKEN=abc123 node:22 bash -lc "npm ci && npm test" --network host';

describe.skipIf(STOCK === undefined)('inline code wider than the whole line', () => {
  const width = 40;
  const { stock, patched } = inlineCodeParagraph(LONG_COMMAND, width, { tail: ' when done.' });

  test('control: stock Droid breaks the command into rows', () => {
    expect(LONG_COMMAND.length).toBeGreaterThan(width * 2);
    expect(stock.lines.some((line) => line.includes(LONG_COMMAND))).toBe(false);
    expect(stock.lines.every((line) => Bun.stringWidth(line) <= width)).toBe(true);
  });

  test('prints the whole command on one line with plain spaces', () => {
    expect(patched.lines.map((line) => line.trimEnd())).toEqual([
      'You run',
      LONG_COMMAND,
      'when done.',
    ]);
  });

  test('tells the Text to leave the long line alone, so Ink does not break it again', () => {
    expect(patched.wrap).toBe(UNWRAPPED);
  });

  test('moves the command off a line that already holds words', () => {
    const [first] = inlineCodeParagraph(LONG_COMMAND, width, { tail: '' }).patched.lines;
    expect(first?.trimEnd()).toBe('You run');
  });

  test('keeps the stock wrapping outside the transcript', () => {
    const outside = inlineCodeParagraph(LONG_COMMAND, width, { unwrapCode: false });
    expect(outside.patched.wrap).toBeUndefined();
    expect(outside.patched.lines.every((line) => Bun.stringWidth(line) <= width)).toBe(true);
  });
});

function communications(source: string): string[] {
  return [...source.matchAll(/`# Communication\n[^`]*`(?:\+"[^"]*"\+`[^`]*`)?/gu)].map(
    ([template]) => payloadFunction<[], string>([], `return ${template}`)(),
  );
}

describe.skipIf(STOCK === undefined)('the system prompt', () => {
  const patched = joinApp(
    patchSource(sourceApp(), [
      patchNamed(codeCopyPatches, 'code-copy-prompt-short'),
      patchNamed(codeCopyPatches, 'code-copy-prompt-long'),
    ]),
  );
  const stockPrompt = joinApp(sourceApp());
  const requested = 'No emojis unless requested.\n';

  test('both Communication variants say the line right after the formatting rule', () => {
    const prompts = communications(patched);
    expect(prompts).toHaveLength(2);
    for (const prompt of prompts) {
      expect(prompt).toContain(`${requested}${COPY_PROMPT_LINE}\n- Use a comma`);
    }
  });

  test('control: stock Droid has both variants and neither carries the line', () => {
    const prompts = communications(stockPrompt);
    expect(prompts).toHaveLength(2);
    for (const prompt of prompts) {
      expect(prompt).toContain(requested);
      expect(prompt).not.toContain(COPY_PROMPT_LINE);
    }
  });

  test('the line is the exact text the model reads', () => {
    expect(COPY_PROMPT_LINE).toBe(
      '- Put any command the user may copy and run in a fenced code block, not as inline code in a sentence, so a terminal copy pastes it whole.',
    );
  });
});

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
