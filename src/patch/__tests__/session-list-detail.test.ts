import { afterEach, describe, expect, test } from 'bun:test';

import { DETAIL_CHROME_ROWS } from '../session-list-patches.ts';
import type { Given } from './session-list-items.ts';
import { item, many, NOW, plain } from './session-list-items.ts';
import { picker } from './session-mention-picker.ts';

const WIDTH = 116;
const ROWS = 50;
const HEIGHT = ROWS - DETAIL_CHROME_ROWS;

function numbered(count: number): string {
  return Array.from({ length: count }, (_unused, index) => `w${index}`).join(' ');
}

function full(given: Given, rows = ROWS): string[] {
  picker.$ODdetail = true;
  return picker
    .$ODsessionView([item(given)], 0, WIDTH, rows, 0, NOW)
    .lines.map((line) => plain(line).slice(2));
}

afterEach(() => {
  picker.$ODdetail = false;
});

describe('the detail view shows only the selected session, over the whole window', () => {
  test('it fills the window height instead of stopping at the list cap', () => {
    expect(full({ last: numbered(900), text: numbered(900) })).toHaveLength(HEIGHT);
  });

  test('other sessions are left out', () => {
    picker.$ODdetail = true;
    const view = picker.$ODsessionView(many(5, { title: 'Other one' }), 2, WIDTH, ROWS, 0, NOW);
    const text = view.lines.map((line) => plain(line));
    expect(text.filter((line) => line.includes('Other one'))).toHaveLength(1);
    expect(view.right).toBe('3/5');
  });

  test('the header gives title, counts, place and path', () => {
    const lines = full({ title: 'Fix the lag', cwd: '/home/me/dev/proj', count: 12 });
    expect(lines[0]).toBe('Fix the lag');
    expect(lines[1]).toBe('1h \u00B7 12 messages \u00B7 started 3h ago');
    expect(lines[2]).toBe('proj \u00B7 main');
    expect(lines[3]).toContain('proj');
  });

  test('the first message is shown under its label', () => {
    const lines = full({ text: 'the panel stutters' });
    expect(lines[5]).toBe('first message');
    expect(lines[6]).toBe('the panel stutters');
  });

  test('a short last message follows under its own label with the age', () => {
    const lines = full({ last: 'all done here' });
    const at = lines.indexOf('last message \u00B7 droid \u00B7 1h ago');
    expect(at).toBeGreaterThan(0);
    expect(lines[at + 1]).toBe('all done here');
  });

  test('a last message from this minute is called just now', () => {
    picker.$ODdetail = true;
    const given = item({ last: 'x' });
    if (given.$ODrow === undefined) {
      throw new Error('item has no row');
    }
    given.$ODrow.$ODlast = { at: NOW, role: 'user', text: 'x' };
    const lines = picker.$ODsessionView([given], 0, WIDTH, ROWS, 0, NOW).lines.map((l) => plain(l));
    expect(lines.some((line) => line.endsWith('last message \u00B7 you \u00B7 just now'))).toBe(
      true,
    );
  });

  test('a long last message shows its start, a gap and its end', () => {
    const lines = full({ last: numbered(900) });
    const at = lines.findIndex((line) => line.startsWith('last message'));
    const body = lines.slice(at + 1).filter((line) => line !== '');
    expect(body[0]).toStartWith('w0 w1');
    expect(body).toContain('\u2026');
    expect(body.at(-1)).toEndWith('w899');
  });

  test('a long first message is cut so the last message keeps room', () => {
    const lines = full({ text: numbered(900), last: numbered(900) });
    expect(lines.some((line) => line.startsWith('last message'))).toBe(true);
    expect(lines.at(-1)).toEndWith('w899');
  });

  test('a session without a last message has no last section', () => {
    expect(full({}).some((line) => line.startsWith('last message'))).toBe(false);
  });

  test('every line fits inside the box', () => {
    for (const line of full({ last: numbered(900), text: numbered(900) })) {
      expect(Bun.stringWidth(line)).toBeLessThanOrEqual(WIDTH - 2);
    }
  });

  test('a low window cuts the view to its height', () => {
    expect(full({ last: numbered(900), text: numbered(900) }, 14)).toHaveLength(7);
  });

  test('the footer says how to go back', () => {
    picker.$ODdetail = true;
    expect(picker.$ODsessionView([item()], 0, WIDTH, ROWS, 0, NOW).left).toBe(
      '\u2190 back \u00B7 \u2191\u2193 \u00B7 \u23CE select \u00B7 esc',
    );
  });
});

describe('the list while the detail is off', () => {
  test('keeps every session, one block each', () => {
    picker.$ODdetail = false;
    const view = picker.$ODsessionView(many(3, { last: 'hi' }), 0, WIDTH, ROWS, 0, NOW);
    expect(
      view.lines.map((line) => plain(line)).filter((line) => line.includes('Fix the lag')),
    ).toHaveLength(3);
  });
});

describe('setting the detail', () => {
  test('changes the detail and asks the list to redraw only when it changes', () => {
    let redraws = 0;
    picker.$ODredraw = () => {
      redraws += 1;
    };
    picker.$ODsetDetail(true);
    picker.$ODsetDetail(true);
    expect(picker.$ODdetail).toBe(true);
    picker.$ODsetDetail(false);
    expect(picker.$ODdetail).toBe(false);
    expect(redraws).toBe(2);
    picker.$ODredraw = undefined;
  });
});
