import { describe, expect, test } from 'bun:test';

import {
  boxSpans,
  draftOf,
  findInputBox,
  hasInputBox,
  linesOf,
  withoutInputBox,
} from '../input-box.ts';

const RULE = '─'.repeat(20);
const HEAVY = '━'.repeat(20);

const STOCK = ['╭────────────────────╮', '│ > hello            │', '╰────────────────────╯'];
const PATCHED = [RULE, '  > hello', RULE];
const BOXES: [string, string[]][] = [
  ['stock', STOCK],
  ['patched', PATCHED],
];

describe.each(BOXES)('the %s input box', (_, box) => {
  const screen = ['reply', ' status row', ...box, ' footer'];

  test('is found by its rows and its edges', () => {
    const found = findInputBox(screen);
    expect(found?.top).toBe(2);
    expect(found?.bottom).toBe(4);
    expect(found?.rows).toEqual(['> hello']);
  });

  test('gives the text typed after the prompt', () => {
    expect(draftOf(screen)).toBe('hello');
  });

  test('is cut out of the lines around it', () => {
    expect(withoutInputBox(screen)).toEqual(['reply', ' status row', ' footer']);
  });

  test('is not found in lines that stop before the bottom edge', () => {
    expect(findInputBox(screen.slice(0, 4))).toBeUndefined();
    expect(draftOf(screen.slice(0, 4))).toBeUndefined();
  });

  test('spans the columns its bottom edge covers', () => {
    const cols = (box[2] ?? '').length;
    expect(boxSpans(screen.join('\n'), cols)).toBe(true);
    expect(boxSpans(screen.join('\n'), cols + 1)).toBe(false);
  });
});

describe('findInputBox', () => {
  test('reads every row of a multi-line draft, without the padding', () => {
    const stock = ['╭───────╮', '│ > one │', '│ two   │', '╰───────╯'];
    const patched = [RULE, '  > one', '    two', RULE];
    expect(findInputBox(stock)?.rows).toEqual(['> one', 'two']);
    expect(findInputBox(patched)?.rows).toEqual(['> one', '  two']);
  });

  test('takes the labelled top of a spec or subagent box', () => {
    const spec = ['─── Spec ────────────', '  > hi', RULE];
    const subagent = ['━━━ SUBAGENT ━━━━━━━━', '  > hi', HEAVY];
    expect(findInputBox(spec)?.topLine).toBe('─── Spec ────────────');
    expect(findInputBox(subagent)?.bottomLine).toBe(HEAVY);
    expect(findInputBox(['╭── Spec ──╮', '│ > hi │', '╰────╯'])?.rows).toEqual(['> hi']);
  });

  test('the box nearest the bottom wins, and a rule alone is not a box', () => {
    const lines = [RULE, 'text', RULE, ...PATCHED, ...STOCK];
    expect(findInputBox(lines)?.top).toBe(6);
    expect(findInputBox([RULE, 'text', RULE])).toBeUndefined();
  });

  test('a divider with a quoted line under it is not a box without a second rule', () => {
    expect(findInputBox([RULE, '  > quoted', 'more text'])).toBeUndefined();
  });
});

describe('hasInputBox', () => {
  test('strips terminal colour before it looks', () => {
    const colored = `\u001B[2m${RULE}\u001B[22m\r\n  > hi\r\n${RULE}`;
    expect(hasInputBox(colored)).toBe(true);
    expect(linesOf('a\r\nb\nc')).toEqual(['a', 'b', 'c']);
  });
});
