import { describe, expect, test } from 'bun:test';

import type { Given } from './session-list-items.ts';
import {
  blockIn,
  BORDER_AND_PADDING,
  contentOf,
  gutterOf,
  item,
  LONG,
  NOW,
  plain,
} from './session-list-items.ts';
import { picker } from './session-mention-picker.ts';

const LONG_ASK: Given = { text: LONG };

const META = '12 messages \u00B7 started 3h ago';

function selectedIn(room: number, given = LONG_ASK): string[] {
  return blockIn(given, { selected: true, width: 80, room }).map((line) => contentOf(line, 80));
}

describe('the selected session fits the window it is given', () => {
  test('with one line it keeps only the title', () => {
    expect(selectedIn(1)).toEqual(['Fix the lag']);
  });

  test('with two lines it keeps the title and the counts', () => {
    expect(selectedIn(2)).toEqual(['Fix the lag', META]);
  });

  test('with three lines one message line sits between them', () => {
    const lines = selectedIn(3);
    expect(lines).toHaveLength(3);
    expect(lines[1]).toEndWith('\u2026');
    expect(lines[2]).toBe(META);
  });

  test('with four lines two message lines sit between them', () => {
    const lines = selectedIn(4);
    expect(lines).toHaveLength(4);
    expect(lines[3]).toBe(META);
  });

  test.each([6, 7, 40])('with %i lines it opens fully: four message lines', (room) => {
    const lines = selectedIn(room);
    expect(lines).toHaveLength(6);
    expect(lines[5]).toBe(META);
  });

  test('a short message does not grow to fill the room', () => {
    expect(selectedIn(40, {})).toEqual(['Fix the lag', 'the panel stutters', '', META]);
  });

  test('an unselected session keeps three lines whatever the room', () => {
    for (const room of [1, 3, 40]) {
      expect(blockIn({ text: LONG }, { selected: false, width: 80, room })).toHaveLength(3);
    }
  });
});

function lowView(rows: number) {
  const items = Array.from({ length: 12 }, (_unused, index) =>
    item({ id: `s${index}`, title: `Title ${index}`, text: LONG }),
  );
  return picker.$ODsessionView(items, 5, 76, rows, 0, NOW);
}

describe('in a low terminal the selected session is still whole', () => {
  test.each([
    [18, 3],
    [20, 4],
    [22, 6],
  ])('at %i rows it shows %i lines, ending with the counts', (rows, size) => {
    const marked = lowView(rows).lines.filter((line) => plain(line).startsWith('\u258C'));
    expect(marked).toHaveLength(size);
    expect(plain(marked.at(-1) ?? { bg: '', segs: [] })).toContain(META);
  });
});

function titleLine(width: number): string {
  const inner = width - BORDER_AND_PADDING;
  const given = { title: 'Add session name autocomplete', text: LONG, label: 'ovrdroid' };
  return plain(
    picker.$ODsessionBlock(item(given), true, 'band', inner, NOW, 40)[0] ?? { bg: '', segs: [] },
  );
}

describe('narrow boxes keep room for the title', () => {
  test.each([20, 30, 40, 50, 80, 120])('at %i columns the title line shows the title', (width) => {
    const content = contentOf(titleLine(width), width);
    expect(content.length).toBeGreaterThanOrEqual(4);
    expect('Add session name autocomplete').toStartWith(content.replace(/\u2026$/u, ''));
    expect(Bun.stringWidth(titleLine(width))).toBeLessThanOrEqual(width - BORDER_AND_PADDING);
  });

  test.each([40, 50])('at %i columns the time still fits the gutter', (width) => {
    expect(gutterOf(titleLine(width), width)).toBe('1h');
  });

  test('without a gutter the time leads the counts line', () => {
    const lines = blockIn({}, { selected: true, width: 30, room: 40 });
    expect(contentOf(lines.at(-1) ?? '', 30)).toStartWith('1h \u00B7 12 messages');
  });

  test('with a gutter the counts line does not repeat the time', () => {
    const lines = blockIn({}, { selected: true, width: 50, room: 40 });
    expect(contentOf(lines.at(-1) ?? '', 50)).toStartWith('12 messages');
  });
});
