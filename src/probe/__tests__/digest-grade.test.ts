import { describe, expect, test } from 'bun:test';

import { describeGrade, gradeReply, splitItems } from '../digest-grade.ts';
import type { DigestKey } from '../digest-key.ts';

const KEY: DigestKey = {
  compacted: 42,
  mostToolCalls: { run: 21, title: 'Grunt: Browser-test Discord/X sign-in', value: 300 },
  notFound: [{ run: 71, title: 'Grunt: Map specs' }],
  browserTitles: [7, 21, 26, 38, 70].map((run) => ({ run, title: `Grunt: Title ${run}` })),
  mostOutTokens: { run: 21, value: 181_019 },
  briefs: [
    { run: 82, sentence: 'Repo: /a/.b/c (a git worktree).' },
    { run: 83, sentence: 'Repo: /a/.b/c.' },
    { run: 84, sentence: 'Read-only lookup; do not edit repo files.' },
  ],
};

const DOTTED = `Task file: /tmp/x.md

Outcome:
1. Runs with \`compactions=\` above 0: 42 of 84.
2. Highest \`toolCalls=\`: run 21, "Browser-test Discord/X sign-in", 300.
3. Runs with a \`## Report\` that is exactly \`NOT FOUND\`: run 71, "Map specs". No other run matches.
4. Runs whose title mentions a browser, a page, or a screenshot:
   - 7, "Web search Convex exact-page fix"
   - 21, "Browser-test Discord/X sign-in"
   - 26, 38, 70
5. Highest \`outTokens=\`: run 21, 181019.
6. First sentence of each \`## Brief\`:
   - Run 82: "Repo: /a/.b/c (a git worktree)."
   - Run 83: "Repo: /a/.b/c."
   - Run 84: "Read-only lookup; do not edit repo files."`;

const BOLD = `**1.** 42 runs.
**2.** Run 21 with 300 tool calls.
**3.** Run 71.
**4.** Runs 7, 21, 26, 38 and 70.
**5.** Run 21, 181,019 tokens.
**6.** 82: \`Repo: /a/.b/c (a git worktree).\` 83: \`Repo: /a/.b/c.\` 84: \`Read-only lookup; do not edit repo files.\``;

const PAREN = `1) 42
2) run 21, 300
3) 71
4) 7 21 26 38 70
5) run 21, 181019
6) Run 82: “Repo: /a/.b/c (a git worktree).”
Run 83: “Repo: /a/.b/c.”
Run 84: “Read-only lookup; do not edit
repo files.”`;

const HEADINGS = `### 1
42
### 2
Run 21, 300.
### 3
Run 71.
### 4
7, 21, 26, 38, 70
### 5
Run 21: 181019
### 6
82: Repo: /a/.b/c (a git worktree).
83: Repo: /a/.b/c.
84: Read-only lookup; do not edit repo files.`;

const ITEM_WORDS = `Item 1: 42
Item 2: run 21 had 300
Item 3: run 71
Item 4: 7, 21, 26, 38, 70
Item 5: run 21, 181019
Item 6: Repo: /a/.b/c (a git worktree). Repo: /a/.b/c. Read-only lookup; do not edit repo files.`;

const WRONG = `1. Runs with compactions above 0: 40 of 84.
2. Run 20 has the most, 300 calls.
3. None.
4. 21, 26, 38, 70, 74
5. Run 21 has 18101 tokens.
6. Run 82: "Repo:   /a/.b/c (a git
worktree)."
Run 83: "Repo: /a/.b/c."
Run 84: "Read-only lookup."`;

describe('gradeReply', () => {
  test.each([
    ['dotted numbers', DOTTED],
    ['bold numbers', BOLD],
    ['parenthesis numbers', PAREN],
    ['markdown headings', HEADINGS],
    ['Item words', ITEM_WORDS],
  ])('gives full marks to a correct reply with %s', (_style, reply) => {
    const grade = gradeReply(KEY, reply);
    expect(grade.items.map(({ score }) => score)).toEqual([1, 1, 1, 1, 1, 1]);
    expect(grade.total).toBe(6);
  });

  test('scores each wrong answer on its own item', () => {
    const grade = gradeReply(KEY, WRONG);
    expect(grade.items.map(({ item, reason }) => `${item}: ${reason}`)).toEqual([
      '1: said 40, key 42',
      '2: missing run 21',
      '3: missed runs 71',
      '4: missed runs 7; extra runs 74',
      '5: missing value 181019',
      '6: missed runs 84',
    ]);
    expect(grade.items.map(({ score }) => score.toFixed(3))).toEqual([
      '0.000',
      '0.000',
      '0.000',
      '0.667',
      '0.000',
      '0.667',
    ]);
    expect(grade.total.toFixed(3)).toBe('1.333');
  });

  test('scores an item missing from the reply as zero', () => {
    const grade = gradeReply(KEY, '1. 42\n2. run 21, 300');
    expect(grade.items.slice(2)).toEqual([
      { item: 3, score: 0, reason: 'item not found in the reply' },
      { item: 4, score: 0, reason: 'item not found in the reply' },
      { item: 5, score: 0, reason: 'item not found in the reply' },
      { item: 6, score: 0, reason: 'item not found in the reply' },
    ]);
    expect(grade.total).toBe(2);
  });

  test('counts "none" as a match when the key list is empty, and ignores the run total', () => {
    const grade = gradeReply(
      { ...KEY, notFound: [] },
      '1. 42\n2. 21 300\n3. None of the 84 runs.\n4. 7 21 26 38 70\n5. 21 181019\n6. none',
    );
    expect(grade.items[2]).toEqual({ item: 3, score: 1, reason: 'exact' });
  });

  test('reads a thousands separator and reports the first number as the count', () => {
    const grade = gradeReply({ ...KEY, compacted: 1042 }, '1. Of 84 runs, 1,042 had one.');
    expect(grade.items[0]).toEqual({ item: 1, score: 1, reason: 'said 1042, key 1042' });
  });
});

describe('splitItems', () => {
  test('keeps sub-bullets with their item and drops the numbering marker', () => {
    const parts = splitItems(DOTTED);
    expect([...parts.keys()]).toEqual([1, 2, 3, 4, 5, 6]);
    expect(parts.get(1)).toBe(' Runs with `compactions=` above 0: 42 of 84.');
    expect(parts.get(4)).toBe(
      [
        ' Runs whose title mentions a browser, a page, or a screenshot:',
        '   - 7, "Web search Convex exact-page fix"',
        '   - 21, "Browser-test Discord/X sign-in"',
        '   - 26, 38, 70',
      ].join('\n'),
    );
  });
});

describe('describeGrade', () => {
  test('prints one line per item and the total', () => {
    expect(describeGrade(gradeReply(KEY, '1. 42'))).toBe(
      [
        'item 1: 1.00  said 42, key 42',
        'item 2: 0.00  item not found in the reply',
        'item 3: 0.00  item not found in the reply',
        'item 4: 0.00  item not found in the reply',
        'item 5: 0.00  item not found in the reply',
        'item 6: 0.00  item not found in the reply',
        'total: 1.00 out of 6',
      ].join('\n'),
    );
  });
});
