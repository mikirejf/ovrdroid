import { afterEach, describe, expect, mock, spyOn, test } from 'bun:test';

import {
  HIGHLIGHT_MEMO_CHARS,
  HIGHLIGHT_MEMO_ENTRIES,
  highlightPatches,
} from '../highlight-patches.ts';
import { applies } from '../rebase.ts';
import {
  NO_COLOR,
  palette,
  patchedHighlighter,
  rebased,
  stockHighlighter,
  terminal,
  TRUE_COLOR,
} from './highlight-code.ts';
import { STOCK } from './ink-frame-harness.ts';

const ANSI_256 = 2;

const SAMPLES: readonly (readonly [language: string, code: string])[] = [
  [
    'javascript',
    'const total = items.reduce((sum, item) => sum + item.price * 2, 0);\nexport { total };',
  ],
  [
    'typescript',
    'interface User {\n  name: string;\n  age?: number;\n}\nconst user: User = { name: "a" };',
  ],
  [
    'python',
    'def fib(n):\n    """Return the nth number."""\n    return n if n < 2 else fib(n - 1) + fib(n - 2)',
  ],
  ['json', '{"name": "ovrdroid", "tags": ["a", "b"], "count": 3, "ok": true, "none": null}'],
  ['bash', 'for f in *.ts; do\n  echo "$f" | grep -c "import" >> /tmp/out.txt\ndone'],
  ['sql', "SELECT id, name FROM users WHERE created_at > '2024-01-01' ORDER BY name LIMIT 10;"],
  [
    'css',
    '.card > a:hover { color: #ff0000; margin: 0 auto; }\n@media (min-width: 40em) { .card { padding: 2px } }',
  ],
  ['xml', '<div class="a &amp; b"><span id="x">1 &lt; 2</span></div>'],
  ['rust', 'fn main() {\n    let v: Vec<u32> = (1..4).collect();\n    println!("{:?}", v);\n}'],
  ['go', 'package main\n\nfunc main() {\n\tfmt.Println("hi")\n}'],
  [
    'yaml',
    'name: build\non:\n  push:\n    branches: [main]\njobs:\n  test: {runs-on: ubuntu-latest}',
  ],
  ['diff', '--- a/file.ts\n+++ b/file.ts\n@@ -1,2 +1,2 @@\n-old line\n+new line\n unchanged'],
  [
    'markdown',
    '# Title\n\nSome *emphasis* and `code` with a [link](https://example.com).\n\n- one\n- two',
  ],
  ['javascript', 'let a = "5 &lt; 6 &amp; 7 &gt; 3 &quot;quoted&quot; &#39;single&#39;";'],
  ['not-a-language', 'plain text that no grammar knows about'],
];

const [FIRST_LANGUAGE = '', FIRST_CODE = ''] = SAMPLES[0] ?? [];

function colored(text: string): boolean {
  return text.includes('\u001B[');
}

afterEach(() => {
  mock.restore();
  terminal.level = TRUE_COLOR;
  palette.use('dark');
});

describe.skipIf(STOCK === undefined)(
  'every highlight patch applies to the shipped bundle once',
  () => {
    test.each(highlightPatches.map((patch) => [patch.name] as const))('%s', (name) => {
      const rebase = rebased(name);
      expect(applies(rebase)).toBe(true);
      expect(rebase.matches).toBe(1);
    });
  },
);

describe.skipIf(STOCK === undefined)('code block highlight memo', () => {
  test('every sample prints what stock prints, on the first call and on repeats', () => {
    spyOn(console, 'warn').mockImplementation(() => {});
    const stock = stockHighlighter();
    const patched = patchedHighlighter();
    let styled = 0;
    for (let pass = 0; pass < 3; pass += 1) {
      for (const [language, code] of SAMPLES) {
        const html = stock.highlight(code, language);
        expect(patched.highlight(code, language)).toBe(html);
        expect(patched.ansi(html)).toBe(stock.ansi(html));
        expect(patched.diffLine(code, language)).toBe(stock.diffLine(code, language));
        if (pass === 0 && colored(stock.ansi(html))) {
          styled += 1;
        }
      }
    }
    expect(styled).toBeGreaterThan(10);
  });

  test('a line with no language comes back unchanged', () => {
    const patched = patchedHighlighter();
    expect(patched.diffLine(FIRST_CODE)).toBe(FIRST_CODE);
    expect(patched.diffLine(FIRST_CODE, '')).toBe(FIRST_CODE);
    expect(patched.highlights()).toBe(0);
  });

  test('a repeated block runs highlight.js and the span coloring once', () => {
    const patched = patchedHighlighter();
    const stock = stockHighlighter();
    const first = patched.diffLine(FIRST_CODE, FIRST_LANGUAGE);
    const highlights = patched.highlights();
    const colorings = patched.colorings();
    expect(highlights).toBe(1);
    expect(colorings).toBeGreaterThan(3);
    for (let repeat = 0; repeat < 5; repeat += 1) {
      expect(patched.diffLine(FIRST_CODE, FIRST_LANGUAGE)).toBe(first);
    }
    expect(patched.highlights()).toBe(highlights);
    expect(patched.colorings()).toBe(colorings);
    stock.diffLine(FIRST_CODE, FIRST_LANGUAGE);
    stock.diffLine(FIRST_CODE, FIRST_LANGUAGE);
    expect(stock.highlights()).toBe(2);
  });

  test('the same code in another language is highlighted again', () => {
    const patched = patchedHighlighter();
    const stock = stockHighlighter();
    const code = 'class A { def(x) { return x } }';
    const asJavascript = patched.highlight(code, 'javascript');
    const asPython = patched.highlight(code, 'python');
    expect(asJavascript).toBe(stock.highlight(code, 'javascript'));
    expect(asPython).toBe(stock.highlight(code, 'python'));
    expect(asJavascript).not.toBe(asPython);
    expect(patched.highlights()).toBe(2);
  });

  test('a change of terminal color level prints what stock prints for the new level', () => {
    const stock = stockHighlighter();
    const patched = patchedHighlighter();
    const printed: string[] = [];
    for (const level of [TRUE_COLOR, NO_COLOR, ANSI_256, TRUE_COLOR]) {
      terminal.level = level;
      const line = patched.diffLine(FIRST_CODE, FIRST_LANGUAGE);
      expect(line).toBe(stock.diffLine(FIRST_CODE, FIRST_LANGUAGE));
      printed.push(line);
    }
    const [trueColor = '', plain = '', ansi256 = '', again = ''] = printed;
    expect(colored(trueColor)).toBe(true);
    expect(colored(plain)).toBe(false);
    expect(ansi256).not.toBe(trueColor);
    expect(again).toBe(trueColor);
    expect(patched.highlights()).toBe(1);
  });

  test('a change of theme prints what stock prints for the new colors', () => {
    const stock = stockHighlighter();
    const patched = patchedHighlighter();
    const printed: string[] = [];
    for (const name of ['dark', 'light', 'dark'] as const) {
      palette.use(name);
      const line = patched.diffLine(FIRST_CODE, FIRST_LANGUAGE);
      expect(line).toBe(stock.diffLine(FIRST_CODE, FIRST_LANGUAGE));
      printed.push(line);
    }
    const [before = '', changed = '', after = ''] = printed;
    expect(changed).not.toBe(before);
    expect(after).toBe(before);
    expect(patched.highlights()).toBe(1);
  });

  test('a full memo is dropped and every block still prints what stock prints', () => {
    const stock = stockHighlighter();
    const patched = patchedHighlighter();
    const blocks = Array.from(
      { length: HIGHLIGHT_MEMO_ENTRIES + 1 },
      (_blank, index) => `const value${index} = ${index};`,
    );
    for (const block of blocks) {
      patched.diffLine(block, 'javascript');
    }
    expect(patched.highlights()).toBe(blocks.length);
    const [first = '', last = ''] = [blocks[0], blocks.at(-1)];
    expect(patched.diffLine(last, 'javascript')).toBe(stock.diffLine(last, 'javascript'));
    expect(patched.highlights()).toBe(blocks.length);
    expect(patched.diffLine(first, 'javascript')).toBe(stock.diffLine(first, 'javascript'));
    expect(patched.highlights()).toBe(blocks.length + 1);
  });

  test('a memo past its character budget is dropped, so a streamed block cannot pile up its prefixes', () => {
    const patched = patchedHighlighter();
    const line = 'const streamed = 1;\n';
    const prefixes = Math.ceil(HIGHLIGHT_MEMO_CHARS / (line.length * 40)) + 1;
    const blocks = Array.from({ length: prefixes }, (_blank, index) =>
      line.repeat(40).concat(`// ${index}`),
    );
    for (const block of blocks) {
      patched.diffLine(block, 'javascript');
    }
    const highlightsBefore = patched.highlights();
    patched.diffLine(blocks[0] ?? '', 'javascript');
    expect(patched.highlights()).toBe(highlightsBefore + 1);
  });
});
