import type { Area, GridClass, Size, Transformer } from './stream-render-code.ts';

export const REPLY = [
  '# Title with `code`',
  '',
  'Intro paragraph with **bold**, _italic_, ~~strike~~ and a [link](https://example.com/a).',
  '',
  '- item one',
  '- item two',
  '  - nested item',
  '- item three',
  '',
  '1. first',
  '2. second',
  '3. third',
  '',
  '```ts',
  'const price = "$5";',
  'function f() { return 1 }',
  '```',
  '',
  '| a | b |',
  '|---|---|',
  '| 1 | 2 |',
  '',
  'Inline math $x^2 + y^2$ and costs $5 and $10 today.',
  '',
  '$$',
  String.raw`\int_0^1 x dx`,
  '$$',
  '',
  String.raw`\[ a + b \]`,
  '',
  '> quote line',
  '> second',
  '',
  '---',
  '',
  'Footnote[^1] and ![img](a.png) and <json-render>',
  '',
  '[^1]: the note',
  '',
  '[ref]: http://x.y',
  '',
  'Final line [ref]',
  '',
].join('\n');

export const INPUTS = [
  '',
  '\n\n',
  'plain',
  '$',
  '$$',
  '```',
  '```js\nunfinished fence',
  '1.',
  '2) ',
  '- [ ] task\n- [x] done',
  '<json-render>\n{"a":1}',
  '    indented code\n\n    more',
  'a  \nb\\\nc',
  'tab\tseparated | not | a table',
];

export function prefixesOf(text: string, step: number): string[] {
  const cut: string[] = [];
  for (let end = 0; end <= text.length; end += step) {
    cut.push(text.slice(0, end));
  }
  cut.push(text);
  return cut;
}

export interface Operation {
  kind: 'write' | 'clip' | 'unclip';
  at?: [number, number];
  text?: string;
  transform?: Transformer;
  area?: Area;
}

export interface Sample {
  name: string;
  size: Size;
  operations: Operation[];
}

const RED = '\u001B[31m';
const BOLD = '\u001B[1m';
const RESET_COLOR = '\u001B[39m';
const RESET_BOLD = '\u001B[22m';

function write(at: [number, number], text: string, extra: Partial<Operation> = {}): Operation {
  return { kind: 'write', at, text, ...extra };
}

function seeded(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state * 1_664_525 + 1_013_904_223) % 4_294_967_296;
    return state / 4_294_967_296;
  };
}

function crowded(): Operation[] {
  const next = seeded(11);
  const pieces = [
    'abc',
    `${RED}red${RESET_COLOR}`,
    '日本語',
    'x y z',
    `${BOLD}b${RESET_BOLD}`,
    '👍 ok',
  ];
  return Array.from({ length: 80 }, () =>
    write(
      [Math.floor(next() * 130), Math.floor(next() * 44)],
      pieces[Math.floor(next() * pieces.length)] ?? '',
    ),
  );
}

export const SAMPLES: Sample[] = [
  { name: 'an empty grid', size: { width: 5, height: 3 }, operations: [] },
  { name: 'no area at all', size: { width: 0, height: 0 }, operations: [write([0, 0], 'hidden')] },
  { name: 'no height', size: { width: 5, height: 0 }, operations: [write([0, 0], 'hidden')] },
  { name: 'no width', size: { width: 0, height: 2 }, operations: [write([0, 0], 'edge')] },
  {
    name: 'a fractional width',
    size: { width: 7.5, height: 2 },
    operations: [write([0, 0], 'abcdefghij'), write([2, 1], 'xy')],
  },
  {
    name: 'plain and styled text',
    size: { width: 30, height: 4 },
    operations: [
      write([0, 0], 'plain text'),
      write([3, 1], `${RED}red${RESET_COLOR} then ${BOLD}bold${RESET_BOLD}`),
      write([0, 3], 'last row'),
    ],
  },
  {
    name: 'several lines in one write',
    size: { width: 12, height: 5 },
    operations: [write([1, 0], 'one\ntwo\nthree\nfour\nfive\nsix')],
  },
  {
    name: 'wide characters, also at the right edge',
    size: { width: 8, height: 3 },
    operations: [write([0, 0], '日本語'), write([6, 1], '日本'), write([7, 2], '👍')],
  },
  {
    name: 'writes that cover earlier writes',
    size: { width: 10, height: 2 },
    operations: [
      write([0, 0], 'aaaaaaaaaa'),
      write([2, 0], '日本'),
      write([3, 0], 'b'),
      write([0, 1], 'x'),
    ],
  },
  {
    name: 'writes beyond the grid',
    size: { width: 6, height: 2 },
    operations: [write([4, 0], 'overflowing'), write([0, 2], 'below'), write([0, 1], 'in')],
  },
  {
    name: 'a clip on columns',
    size: { width: 12, height: 3 },
    operations: [
      { kind: 'clip', area: { x1: 2, x2: 6 } },
      write([0, 0], '0123456789'),
      write([8, 1], 'gone'),
      { kind: 'unclip' },
      write([0, 2], 'after'),
    ],
  },
  {
    name: 'a clip on rows',
    size: { width: 12, height: 5 },
    operations: [
      { kind: 'clip', area: { y1: 1, y2: 3 } },
      write([0, 0], 'a\nb\nc\nd\ne'),
      { kind: 'unclip' },
    ],
  },
  {
    name: 'a clip on both axes, nested',
    size: { width: 16, height: 6 },
    operations: [
      { kind: 'clip', area: { x1: 1, x2: 10, y1: 0, y2: 5 } },
      { kind: 'clip', area: { x1: 3, x2: 7, y1: 1, y2: 3 } },
      write([0, 0], 'abcdefghijkl\nabcdefghijkl\nabcdefghijkl\nabcdefghijkl'),
      { kind: 'unclip' },
      write([0, 4], 'outer'),
      { kind: 'unclip' },
    ],
  },
  {
    name: 'transformers',
    size: { width: 20, height: 3 },
    operations: [
      write([0, 0], 'shout\nsecond', { transform: (line) => line.toUpperCase() }),
      write([0, 2], 'indexed', { transform: (line, index) => `${index}:${line}` }),
    ],
  },
  { name: 'a crowded frame', size: { width: 120, height: 40 }, operations: crowded() },
];

export function render(Grid: GridClass, sample: Sample): { output: string; height: number } {
  const grid = new Grid(sample.size);
  for (const operation of sample.operations) {
    if (operation.kind === 'clip') {
      grid.clip(operation.area ?? {});
    } else if (operation.kind === 'unclip') {
      grid.unclip();
    } else {
      const [x, y] = operation.at ?? [0, 0];
      grid.write(x, y, operation.text ?? '', {
        transformers: operation.transform === undefined ? [] : [operation.transform],
      });
    }
  }
  return grid.get();
}
