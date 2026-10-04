import { describe, expect, test } from 'bun:test';

import { LABEL_MIN_CELLS, TITLE_MIN_CELLS } from '../session-mention-patches.ts';
import { DIR, repoPicker } from './session-mention-disk.ts';
import type { Session } from './session-mention-harness.ts';
import { AGO, session } from './session-mention-harness.ts';

const BORDER = 1;
const PADDING = 1;
const MARKER = 2;
const WIDTHS = [40, 50, 80, 120];
const META = `${AGO} \u00B7 4 messages`;

function interior(width: number): number {
  return width - 2 * (BORDER + PADDING);
}

function cells(text: string): number {
  return Bun.stringWidth(text);
}

const input = repoPicker({
  '/w/proj/.git': DIR,
  '/w/ovrdroid/.git': DIR,
  [`/w/${'r'.repeat(40)}/.git`]: DIR,
  '/w/\u7D44\u7D44\u7D44\u7D44\u7D44\u7D44\u7D44\u7D44/.git': DIR,
});

const CWDS = new Map<string, string | undefined>([
  ['none', undefined],
  ['short', '/w/proj'],
  ['ovrdroid', '/w/ovrdroid'],
  ['long', `/w/${'r'.repeat(40)}`],
  ['wide', '/w/\u7D44\u7D44\u7D44\u7D44\u7D44\u7D44\u7D44\u7D44'],
]);

interface Spec {
  title: string;
  cwd: string | undefined;
  count?: number;
}

function rowOf({ title, cwd, count = 4 }: Spec, width: number): string {
  const row: Session = { ...session('a', title, 180), cwd, messageCount: count };
  return input.$ODsessionItems([row], width, () => 'q'.repeat(500))[0]?.label ?? '';
}

interface Split {
  first: string;
  second: string;
}

function lines(label: string): Split {
  const [first = '', second = ''] = label.split('\n');
  return { first, second };
}

describe.each(WIDTHS)('at %i columns every line fits inside the dropdown', (width) => {
  const TITLES = [
    'Fix',
    'A rather long title for a session that goes on and on and on',
    'x'.repeat(300),
    '\u7D44'.repeat(60),
  ];
  const COUNTS = [1, 4, 12_345];

  test.each([...CWDS.keys()])('with the %s repo label', (name) => {
    for (const title of TITLES) {
      for (const count of COUNTS) {
        const { first, second } = lines(rowOf({ title, cwd: CWDS.get(name), count }, width));
        expect(MARKER + cells(first)).toBeLessThanOrEqual(interior(width));
        expect(cells(second)).toBeLessThanOrEqual(interior(width));
        expect(second.startsWith('  q')).toBe(true);
      }
    }
  });

  test('the first line keeps the time and count', () => {
    for (const name of CWDS.keys()) {
      expect(lines(rowOf({ title: 'x'.repeat(300), cwd: CWDS.get(name) }, width)).first).toEndWith(
        META,
      );
    }
  });
});

describe('what the first line says', () => {
  test('the label follows the title after two spaces and goes before the time and count', () => {
    expect(lines(rowOf({ title: 'Add autocomplete', cwd: CWDS.get('short') }, 120)).first).toBe(
      `Add autocomplete  proj \u00B7 ${META}`,
    );
  });

  test('a row with no cwd keeps the line it had before the label', () => {
    expect(lines(rowOf({ title: 'Add autocomplete', cwd: undefined }, 120)).first).toBe(
      `Add autocomplete  ${META}`,
    );
  });
});

describe('the first line gives way in a fixed order', () => {
  const heading = (width: number, name: string) => {
    const { first } = lines(rowOf({ title: 'x'.repeat(300), cwd: CWDS.get(name) }, width));
    const at = first.indexOf('  ');
    const tail = first.slice(at + 2);
    const label = tail === META ? '' : tail.slice(0, -(META.length + 3));
    return { title: first.slice(0, at), label };
  };

  test('with room to spare the label and the whole title stay', () => {
    const { title, label } = heading(120, 'short');
    expect(label).toBe('proj');
    expect(title.length).toBeGreaterThan(TITLE_MIN_CELLS);
  });

  test('the title is cut first and the label stays whole while the title keeps its minimum', () => {
    const { title, label } = heading(50, 'ovrdroid');
    expect(label).toBe('ovrdroid');
    expect(cells(title)).toBeGreaterThanOrEqual(TITLE_MIN_CELLS);
  });

  test('then the label is cut, never below its minimum, and the title keeps its minimum', () => {
    const cut = [44, 46, 48, 50, 60].map((width) => heading(width, 'long'));
    for (const { title, label } of cut) {
      expect(cells(title)).toBeGreaterThanOrEqual(TITLE_MIN_CELLS);
      expect(label).toStartWith('rrrr');
      expect(label).toEndWith('\u2026');
      expect(cells(label)).toBeGreaterThanOrEqual(LABEL_MIN_CELLS);
    }
    expect(cut.map(({ label }) => cells(label))).toEqual(
      cut.map(({ label }) => cells(label)).toSorted((a, b) => a - b),
    );
  });

  test('then the label is dropped before the title goes under its minimum', () => {
    for (const width of [40, 42, 43]) {
      const { title, label } = heading(width, 'ovrdroid');
      expect(label).toBe('');
      expect(cells(title)).toBeGreaterThanOrEqual(TITLE_MIN_CELLS);
    }
  });

  test('the reviewer case: 40 columns, ovrdroid, 4 messages', () => {
    const { first } = lines(
      rowOf({ title: 'A long title that cannot fit here', cwd: CWDS.get('ovrdroid') }, 40),
    );
    expect(first).toEndWith(`  ${META}`);
    expect(first).not.toContain('ovrdroid');
    expect(MARKER + cells(first)).toBeLessThanOrEqual(interior(40));
  });

  test.each([44, 46, 50, 60])(
    'wide characters in a label are counted in cells at %i columns',
    (width) => {
      const { first } = lines(rowOf({ title: 'x'.repeat(300), cwd: CWDS.get('wide') }, width));
      expect(MARKER + cells(first)).toBeLessThanOrEqual(interior(width));
      expect(heading(width, 'wide').label).toStartWith('\u7D44');
    },
  );

  test('a row with no cwd has no label at any width', () => {
    for (const width of WIDTHS) {
      expect(heading(width, 'none').label).toBe('');
    }
  });
});

describe('the first line before the label existed is not made longer', () => {
  test.each(WIDTHS)('at %i columns a labelled row is no longer than a bare one', (width) => {
    const title = 'y'.repeat(300);
    const bare = lines(rowOf({ title, cwd: undefined }, width)).first;
    const labelled = lines(rowOf({ title, cwd: CWDS.get('short') }, width)).first;
    expect(cells(labelled)).toBeLessThanOrEqual(cells(bare));
  });
});
