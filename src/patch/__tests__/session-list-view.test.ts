import { describe, expect, test } from 'bun:test';

import { LIST_BODY_CAP, LIST_CHROME_ROWS, NO_MESSAGE } from '../session-list-patches.ts';
import {
  block,
  BORDER_AND_PADDING,
  contentOf,
  gutterOf,
  item,
  LONG,
  many,
  NOW,
  plain,
} from './session-list-items.ts';
import type { Item, Line } from './session-mention-picker.ts';
import { picker } from './session-mention-picker.ts';

const WIDTHS = [50, 80, 120];

describe('the gutter holds the time, the repo and the branch', () => {
  test('16 cells wide from 104 columns, 12 down to 40, a third of the room below, none under 34', () => {
    expect(
      [20, 30, 33, 34, 40, 50, 80, 103, 104, 120].map((width) => picker.$ODgutter(width - 4)),
    ).toEqual([0, 0, 0, 10, 12, 12, 12, 12, 16, 16]);
  });

  test('the time, the repo label and the branch go down the left side', () => {
    expect(block({}, false).map((line) => gutterOf(line))).toEqual(['1h', 'proj', 'main']);
  });

  test('a long repo label is cut at the start, a long branch at the end', () => {
    const lines = block(
      { label: 'staging-deploy-worktree', branch: 'feature/a-very-long-one' },
      false,
      80,
    );
    expect(gutterOf(lines[1] ?? '', 80)).toBe('\u2026oy-worktree');
    expect(gutterOf(lines[2] ?? '', 80)).toBe('feature/a-v\u2026');
  });

  test('no branch leaves the third cell empty', () => {
    expect(gutterOf(block({ branch: null }, false)[2] ?? '')).toBe('');
  });
});

describe('an unselected session is three lines', () => {
  test('the title, then the first message over two lines', () => {
    const lines = block({ text: LONG }, false, 80);
    expect(lines).toHaveLength(3);
    expect(contentOf(lines[0] ?? '', 80)).toBe('Fix the lag');
    expect(contentOf(lines[2] ?? '', 80)).toEndWith('\u2026');
  });

  test('a short message leaves the third line empty', () => {
    expect(block({}, false).map((line) => contentOf(line))).toEqual([
      'Fix the lag',
      'the panel stutters',
      '',
    ]);
  });

  test('a session without a typed message says so', () => {
    expect(contentOf(block({ text: null }, false)[1] ?? '')).toBe(NO_MESSAGE);
  });

  test('the first column is blank', () => {
    for (const line of block({}, false)) {
      expect(line.startsWith(' ')).toBe(true);
    }
  });

  test.each(WIDTHS)('every line fits inside the box at %i columns', (width) => {
    for (const line of block(
      { title: 'T'.repeat(300), text: LONG, label: 'x'.repeat(40) },
      false,
      width,
    )) {
      expect(Bun.stringWidth(line)).toBeLessThanOrEqual(width - BORDER_AND_PADDING);
    }
  });
});

describe('the selected session opens up', () => {
  test('a bar marks every line', () => {
    for (const line of block({}, true)) {
      expect(line.startsWith('\u258C')).toBe(true);
    }
  });

  test('the message wraps over up to four lines, then the counts', () => {
    const lines = block({ text: LONG }, true, 80);
    expect(lines).toHaveLength(6);
    expect(contentOf(lines[4] ?? '', 80)).toEndWith('\u2026');
    expect(contentOf(lines[5] ?? '', 80)).toBe('12 messages \u00B7 started 3h ago');
  });

  test('a short message keeps two message lines', () => {
    expect(block({}, true)).toHaveLength(4);
  });

  test('one message is said in the singular', () => {
    expect(block({ count: 1 }, true).at(-1)).toContain('1 message \u00B7');
  });

  test.each([
    ['a subfolder of the repo', { root: false, cwd: '/srv/proj/src' }],
    ['a worktree', { root: false, cwd: '/srv/wt/proj-fix' }],
    ['a folder whose path does not fit the gutter', { label: 'x'.repeat(30), cwd: '/srv/x' }],
  ])('the path follows the counts for %s', (_case, given) => {
    expect(block(given, true).at(-1)).toEndWith(`started 3h ago \u00B7 ${given.cwd}`);
  });

  test('the repo root says nothing more than its label', () => {
    expect(block({}, true).at(-1)).not.toContain('proj');
  });

  test('a long path is cut at its start', () => {
    const cwd = `/srv/${'deep/'.repeat(30)}end`;
    const meta = contentOf(block({ root: false, cwd }, true, 80).at(-1) ?? '', 80);
    expect(meta).toContain('\u2026');
    expect(meta).toEndWith('/end');
  });

  test.each(WIDTHS)('every line fits inside the box at %i columns', (width) => {
    const given = {
      title: 'T'.repeat(300),
      text: LONG,
      root: false,
      cwd: `/srv/${'d/'.repeat(80)}`,
    };
    for (const line of block(given, true, width)) {
      expect(Bun.stringWidth(line)).toBeLessThanOrEqual(width - BORDER_AND_PADDING);
    }
  });
});

interface Screen {
  rows?: number;
  top?: number;
}

function view(items: readonly Item[], selected: number, { rows = 40, top = 0 }: Screen = {}) {
  return picker.$ODsessionView(items, selected, 116, rows, top, NOW);
}

function idsShown(lines: readonly Line[], items: readonly Item[]): string[] {
  const titles = lines.map((line) => plain(line)).filter((line) => /^. \d/u.test(line));
  return titles.map((line) => items.find((entry) => line.endsWith(entry.label))?.$ODsession ?? '?');
}

describe('the window shows whole sessions around the selected one', () => {
  const items = Array.from({ length: 30 }, (_unused, index) =>
    item({ id: `s${index}`, title: `Title ${index}` }),
  );
  const height = Math.min(LIST_BODY_CAP, 40 - LIST_CHROME_ROWS);

  test('the box keeps the same height wherever the selection is', () => {
    let top = 0;
    for (let selected = 0; selected < items.length; selected += 1) {
      const shown = view(items, selected, { rows: 40, top });
      expect(shown.lines).toHaveLength(height);
      top = shown.top;
    }
  });

  test('the selected session is always shown in full', () => {
    let top = 0;
    for (let selected = 0; selected < items.length; selected += 1) {
      const shown = view(items, selected, { rows: 40, top });
      const bars = shown.lines.filter((line) => plain(line).startsWith('\u258C'));
      expect(bars).toHaveLength(4);
      top = shown.top;
    }
  });

  test('moving down keeps the top until the selection would leave the window', () => {
    expect(view(items, 4, { rows: 40, top: 0 }).top).toBe(0);
    expect(view(items, 7, { rows: 40, top: 0 }).top).toBeGreaterThan(0);
  });

  test('moving up past the top scrolls by whole sessions', () => {
    expect(view(items, 3, { rows: 40, top: 6 }).top).toBe(3);
  });

  test('at the bottom the last session is shown and the window does not run past it', () => {
    const shown = view(items, items.length - 1, { rows: 40, top: 0 });
    expect(idsShown(shown.lines, items).at(-1)).toBe('s29');
    expect(view(items, items.length - 1, { rows: 40, top: shown.top }).top).toBe(shown.top);
  });

  test('at the top the first session starts on the first row', () => {
    expect(plain(view(items, 0, { rows: 40, top: 5 }).lines[0] ?? { bg: '', segs: [] })).toContain(
      'Title 0',
    );
  });

  test('a session that does not fit whole peeks into the rows left over', () => {
    const shown = view(items, 0, { rows: 42, top: 0 });
    expect(shown.lines).toHaveLength(26);
    expect(idsShown(shown.lines, items).at(-1)).toBe('s6');
    expect(plain(shown.lines.at(-1) ?? { bg: '', segs: [] })).toContain('Title 6');
  });

  test('a blank row sits between sessions, none after the last', () => {
    const { lines } = view(items, 0, { rows: 40, top: 0 });
    expect(plain(lines[4] ?? { bg: '', segs: [] })).toBe('');
    expect(plain(lines[5] ?? { bg: '', segs: [] })).toContain('Title 1');
    expect(plain(lines[8] ?? { bg: '', segs: [] })).toBe('');
    const bottom = view(items, items.length - 1, { rows: 40, top: 0 }).lines;
    expect(plain(bottom.at(-1) ?? { bg: '', segs: [] })).not.toBe('');
  });

  test('only the selected session has a background, and the blank rows have none', () => {
    const tones = view(items, 0, { rows: 40, top: 0 }).lines.map((line) => line.bg);
    expect(tones.slice(0, 10)).toEqual(['band', 'band', 'band', 'band', '', '', '', '', '', '']);
    expect(new Set(tones)).toEqual(new Set(['band', '']));
  });

  test('the footer gives the keys and the position', () => {
    const shown = view(items, 2);
    expect(shown.left).toBe(
      '\u2191\u2193 \u00B7 \u2190\u2192 detail \u00B7 \u23CE select \u00B7 esc',
    );
    expect(shown.right).toBe('3/30');
  });
});

describe('the box height', () => {
  test(`is the terminal height less ${LIST_CHROME_ROWS} rows, at most ${LIST_BODY_CAP}`, () => {
    const items = many(40);
    expect(view(items, 0, { rows: 30 }).lines).toHaveLength(14);
    expect(view(items, 0, { rows: 80 }).lines).toHaveLength(LIST_BODY_CAP);
  });

  test('a short list is as tall as its sessions with the selected one opened as far as it can', () => {
    const two = many(2, { text: 'short' });
    expect(view(two, 0).lines).toHaveLength(11);
    expect(view(two, 1).lines).toHaveLength(11);
  });

  test('a tiny terminal still shows at least three rows', () => {
    expect(view(many(5), 0, { rows: 10 }).lines).toHaveLength(3);
  });
});
