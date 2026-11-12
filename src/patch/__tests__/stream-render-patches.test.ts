import { describe, expect, test } from 'bun:test';
import path from 'node:path';

import { applies } from '../rebase.ts';
import { MARKDOWN_MEMO_ENTRIES, streamRenderPatches } from '../stream-render-patches.ts';
import { STOCK } from './ink-frame-harness.ts';
import type { Cell, GridClass } from './stream-render-code.ts';
import {
  patchedGrid,
  patchedMarkdown,
  stockGrid,
  stockMarkdown,
  stockPainters,
} from './stream-render-code.ts';
import { INPUTS, prefixesOf, render, REPLY, SAMPLES } from './stream-render-frames.ts';
import { guarded, importBindings, importedValue, rebased } from './stream-render-harness.ts';

describe('stream render module imports', () => {
  test.each([
    [
      'import{$a as $b,c}from"path";',
      [
        ['$b', '$a'],
        ['c', 'c'],
      ],
    ],
    ['import*as $ns from"path";', [['$ns', '*']]],
    ['import $default from"path";', [['$default', 'default']]],
    [
      'import $default,*as $ns from"path";',
      [
        ['$default', 'default'],
        ['$ns', '*'],
      ],
    ],
    [
      'import $default,{join as $j}from"path";',
      [
        ['$default', 'default'],
        ['$j', 'join'],
      ],
    ],
  ] as const)('reads bindings from %s', (source, entries) => {
    expect([...importBindings(source)]).toStrictEqual(
      entries.map(([local, exported]) => [local, { from: 'path', exported }]),
    );
  });

  test('namespace imports resolve to exports, not a property named star', () => {
    expect(importedValue('import*as $ns from"path";', '$ns')).toBe(path);
    expect(importedValue('import $p,*as $ns from"node:path";', '$ns')).toBe(path);
    expect(importedValue('import $p,*as $ns from"node:path";', '$p')).toBe(path);
    expect(importedValue('import{posix as $p}from"path";', '$p')).toBe(path.posix);
  });
});

describe.skipIf(STOCK === undefined)(
  'every stream render patch applies to the shipped bundle once',
  () => {
    test.each(streamRenderPatches.map((patch) => [patch.name] as const))('%s', (name) => {
      const rebase = rebased(name);
      expect(applies(rebase)).toBe(true);
      expect(rebase.matches).toBe(1);
    });
  },
);

describe.skipIf(STOCK === undefined)('markdown-parse-memo', () => {
  test('every input parses to the tree stock builds, with the same unfinished line', () => {
    const stock = stockMarkdown();
    const patched = patchedMarkdown();
    for (const input of [...INPUTS, REPLY]) {
      expect(patched.parse(input)).toStrictEqual(stock.parse(input));
    }
  });

  test('every prefix of a streamed reply parses to the tree stock builds', () => {
    const stock = stockMarkdown();
    const patched = patchedMarkdown();
    const prefixes = prefixesOf(REPLY, 13);
    expect(prefixes.length).toBeGreaterThan(35);
    const built = prefixes.map((prefix) => stock.parse(prefix));
    for (let pass = 0; pass < 2; pass += 1) {
      for (const [index, expected] of built.entries()) {
        expect(patched.parse(prefixes[index] ?? '')).toStrictEqual(expected);
      }
    }
  }, 60_000);

  test('the streamed reply holds every block the renderer reads', () => {
    const types = new Set<unknown>();
    const visit = (node: unknown): void => {
      if (typeof node !== 'object' || node === null) {
        return;
      }
      for (const [key, value] of Object.entries(node)) {
        if (key === 'type') {
          types.add(value);
        } else if (Array.isArray(value)) {
          for (const child of value) {
            visit(child);
          }
        }
      }
    };
    visit(patchedMarkdown().parse(REPLY).root);
    for (const type of [
      'heading',
      'list',
      'code',
      'table',
      'math',
      'inlineMath',
      'blockquote',
      'thematicBreak',
      'definition',
      'footnoteDefinition',
      'delete',
    ]) {
      expect(types.has(type)).toBe(true);
    }
  });

  test('the second call with the same string returns the first result without parsing', () => {
    const patched = patchedMarkdown();
    const first = patched.parse(REPLY);
    expect(patched.parse(REPLY)).toBe(first);
    expect(patched.parses()).toBe(1);
    expect(stockMarkdown().parse(REPLY)).not.toBe(stockMarkdown().parse(REPLY));
  });

  test('a string that differs only by a trailing newline is parsed again', () => {
    const patched = patchedMarkdown();
    const stock = stockMarkdown();
    const first = patched.parse('a paragraph');
    const second = patched.parse('a paragraph\n');
    expect(second).not.toBe(first);
    expect(second).toStrictEqual(stock.parse('a paragraph\n'));
    expect(patched.parses()).toBe(2);
  });

  test('the newest strings stay cached and older ones are parsed again', () => {
    const patched = patchedMarkdown();
    const stock = stockMarkdown();
    const inputs = Array.from(
      { length: MARKDOWN_MEMO_ENTRIES + 1 },
      (_blank, index) => `paragraph ${index} with *emphasis*`,
    );
    const results = inputs.map((input) => patched.parse(input));
    expect(patched.parses()).toBe(inputs.length);
    for (const [index, result] of results.entries()) {
      if (index > 0) {
        expect(patched.parse(inputs[index] ?? '')).toBe(result);
      }
    }
    expect(patched.parses()).toBe(inputs.length);
    const [oldest = ''] = inputs;
    expect(patched.parse(oldest)).toStrictEqual(stock.parse(oldest));
    expect(patched.parses()).toBe(inputs.length + 1);
  });

  test('a parse that throws is not remembered and throws again', () => {
    const patched = patchedMarkdown({ throwOn: 'BAD' });
    expect(() => patched.parse('a BAD line')).toThrow('parser failure');
    expect(() => patched.parse('a BAD line')).toThrow('parser failure');
    expect(patched.parses()).toBe(2);
    expect(patched.parse('fine')).toBe(patched.parse('fine'));
    expect(patched.parses()).toBe(3);
  });

  test('the cut offsets of a streamed reply match stock while the tree is write-protected', () => {
    const stock = stockMarkdown();
    const patched = patchedMarkdown({ guardResults: true });
    let stockCuts: number[] = [];
    let patchedCuts: number[] = [];
    let moved = 0;
    for (const prefix of prefixesOf(REPLY, 11)) {
      const next = stock.cuts(prefix, stockCuts);
      patchedCuts = patched.cuts(prefix, patchedCuts);
      expect(patchedCuts).toStrictEqual(next);
      moved += next.length === stockCuts.length ? 0 : 1;
      stockCuts = next;
    }
    expect(moved).toBeGreaterThan(3);
  });

  test('the write protection refuses a write to the tree', () => {
    const patched = patchedMarkdown({ guardResults: true });
    const { root } = patched.parse(REPLY);
    expect(root.children.length).toBeGreaterThan(5);
    expect(() => root.children.push({})).toThrow();
    expect(() => {
      guarded({ a: 1 }).a = 2;
    }).toThrow();
  });
});

describe.skipIf(STOCK === undefined)('ink-blank-cell-shared', () => {
  test.each(SAMPLES.map((sample) => [sample.name, sample] as const))(
    'the grid prints what stock prints for %s',
    (_name, sample) => {
      expect(render(patchedGrid(), sample)).toStrictEqual(render(stockGrid(), sample));
    },
  );

  test('the sample frames print visible text', () => {
    const printed = SAMPLES.map((sample) => render(stockGrid(), sample).output.trim().length);
    expect(printed.filter((length) => length > 0).length).toBeGreaterThan(10);
  });

  test('one grid class prints the same frame again after another frame', () => {
    const Grid = patchedGrid();
    const sample = SAMPLES.find((entry) => entry.name === 'plain and styled text');
    if (sample === undefined) {
      throw new Error('the samples changed');
    }
    const first = render(Grid, sample);
    render(Grid, { name: 'other', size: { width: 9, height: 9 }, operations: [] });
    expect(render(Grid, sample)).toStrictEqual(first);
  });

  test('one blank cell is made for a frame, not one for every position', () => {
    let made = 0;
    const Grid = patchedGrid({
      blank: (cell) => {
        made += 1;
        return cell;
      },
    });
    render(Grid, { name: 'big', size: { width: 200, height: 60 }, operations: [] });
    expect(made).toBe(1);
  });

  test('the frames print the same when nothing may write to the shared cell or its styles', () => {
    const Grid = patchedGrid({ blank: (cell) => guarded(cell) });
    for (const sample of SAMPLES) {
      expect(render(Grid, sample)).toStrictEqual(render(stockGrid(), sample));
    }
  });

  test.each(['selection', 'hover'] as const)(
    'the stock %s painter replaces guarded blank slots without changing other positions',
    (kind) => {
      const painters = stockPainters();
      for (const color of [undefined, '#345678']) {
        let blank: Cell | undefined;
        const Grid = patchedGrid({
          blank: (cell) => {
            blank = guarded(cell);
            return blank;
          },
        });
        const paint = (cells: Cell[][], box: { x: number; y: number }) => {
          const spans = [{ row: 0, start: 0, end: 2 }];
          if (kind === 'selection') {
            painters.selection(cells, box, spans, color);
          } else {
            painters.hover(cells, box, { spans, text: '  X', contrastGlyph: true }, color);
          }
        };
        const frame = (Output: GridClass) => {
          const grid = new Output({ width: 8, height: 3 });
          grid.paint(paint, { x: 1, y: 1 });
          grid.write(3, 1, '\u001B[31mX\u001B[39m', { transformers: [] });
          return grid.get();
        };
        const expected = frame(stockGrid());
        expect(frame(Grid)).toStrictEqual(expected);
        expect(expected.output).toContain('X');
        if (kind === 'selection') {
          expect(expected.output).toContain(color === undefined ? '\u001B[7m' : '\u001B[48;2;');
        } else if (color !== undefined) {
          expect(expected.output).toContain('\u001B[48;2;');
        }
        expect(blank?.type).toBe('char');
        expect(blank?.value).toBe(' ');
        expect(blank?.fullWidth).toBe(false);
        expect(blank?.styles.length).toBe(0);
        expect(
          render(Grid, { name: 'after paint', size: { width: 8, height: 3 }, operations: [] }),
        ).toStrictEqual({ output: '\n\n', height: 3 });
      }
    },
  );
});
