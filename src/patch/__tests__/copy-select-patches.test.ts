import { describe, expect, test } from 'bun:test';

import { patchSource } from '../../binary/apply.ts';
import { joinApp } from '../../binary/graph.ts';
import { copySelectPatches } from '../copy-select-patches.ts';
import { applies } from '../rebase.ts';
import { subagentInputPatches } from '../subagent-input-patches.ts';
import { freeNames, renameIn } from '../tokens.ts';
import { captureShell, shellRenderer, shippedShell } from './copy-select-shell.ts';
import { closureOf, declarationText } from './module-closure.ts';
import { describeStrayNames, patchNamed, payloadFunction } from './payload.ts';
import { requireStock, shipped, stockDroid, stockText } from './stock-scanner.ts';

describeStrayNames(copySelectPatches);

const TOP_CORNERS = /[\u256D\u256E]/gu;

interface Box {
  flexDirection?: string;
  borderStyle?: string;
  borderLeft?: boolean;
  borderRight?: boolean;
  borderTop?: boolean;
  borderBottom?: boolean;
  paddingLeft?: number;
  paddingRight?: number;
  paddingX?: number;
  width?: number | string;
  children?: unknown;
}

function element(_type: unknown, props: Box): Box {
  return props;
}

function sideColumns(box: Box) {
  const bordered = box.borderStyle !== undefined;
  const left =
    (bordered && box.borderLeft !== false ? 1 : 0) + (box.paddingLeft ?? box.paddingX ?? 0);
  const right =
    (bordered && box.borderRight !== false ? 1 : 0) + (box.paddingRight ?? box.paddingX ?? 0);
  return { left, right, text: Number(box.width) - left - right };
}

const WIDTH = 60;

describe('the markdown blockquote', () => {
  const patch = patchNamed(copySelectPatches, 'copy-select-blockquote-flat');
  const quote = (bar: string): Box => {
    const config = { maxWidth: 40, colors: { blockquote: 'gray' } };
    return payloadFunction<unknown[], Box>(
      ['t', 'c', 'y', 'TR'],
      `return t(c,{flexDirection:"column",width:y.config.maxWidth,${bar}children:TR()})`,
    )(element, 'Box', { config }, () => 'quoted');
  };

  test('control: stock draws a bar and indents the text', () => {
    const stock = quote(patch.find);
    expect(stock.borderStyle).toBe('single');
    expect(stock.borderLeft).toBe(true);
    expect(stock.paddingLeft).toBe(1);
  });

  test('draws no bar and no indent, so a copied line starts with the quote', () => {
    const flat = quote(patch.replace);
    expect(flat.borderStyle).toBeUndefined();
    expect(flat.borderLeft).toBeUndefined();
    expect(flat.paddingLeft).toBeUndefined();
  });

  test('keeps the column layout, the width and the children', () => {
    expect(quote(patch.replace)).toEqual({
      flexDirection: 'column',
      width: 40,
      children: 'quoted',
    });
  });
});

type LabelLine = (width: number, label: string, detail?: string) => string;

function build(source: string): LabelLine {
  return payloadFunction<[typeof Bun.stringWidth], LabelLine>(
    ['Z'],
    `${source};return xfe`,
  )(Bun.stringWidth);
}

describe('the label line of the chat input', () => {
  const patch = patchNamed(copySelectPatches, 'copy-select-label-line-straight');
  const stock = build(patch.find);
  const straight = build(patch.replace);
  const widths = Array.from({ length: 80 }, (_unused, index) => index + 1);

  test('at every width it is the stock line with plain rules for corners', () => {
    for (const width of widths) {
      for (const [label, detail] of [
        ['SUBAGENT', undefined],
        ['spec', 'Add a login page'],
      ] as const) {
        const line = straight(width, label, detail);
        expect(line).toBe(stock(width, label, detail).replaceAll(TOP_CORNERS, '\u2500'));
        expect(Bun.stringWidth(line)).toBe(Bun.stringWidth(stock(width, label, detail)));
      }
    }
  });

  test('carries no corner glyph', () => {
    expect(straight(WIDTH, 'SUBAGENT')).toBe(
      `\u2500\u2500\u2500 SUBAGENT ${'\u2500'.repeat(WIDTH - 13)}`,
    );
  });
});

describe('the labeled box of the chat input', () => {
  const patch = patchNamed(copySelectPatches, 'copy-select-labeled-box-no-sides');
  const box = (tail: string): Box =>
    payloadFunction<unknown[], Box>(
      ['l', 'c', 'gs', 'V', 'E', 'Vs', 'al', 'da'],
      `return l(c,{borderStyle:"round",borderColor:gs,borderDimColor:!V,borderTop:!1,width:E,${tail}})`,
    )(element, 'Box', 'magenta', true, WIDTH, 'rows', null, null);
  const stock = box(patch.find);
  const patched = box(patch.replace);

  test('control: stock draws both side borders', () => {
    expect(stock.borderLeft).toBeUndefined();
    expect(stock.borderRight).toBeUndefined();
    expect(sideColumns(stock)).toEqual({ left: 2, right: 2, text: WIDTH - 4 });
  });

  test('turns the side borders off', () => {
    expect(patched.borderLeft).toBe(false);
    expect(patched.borderRight).toBe(false);
  });

  test('keeps the bottom border and the missing top border', () => {
    expect(patched.borderStyle).toBe('round');
    expect(patched.borderBottom).toBeUndefined();
    expect(patched.borderTop).toBe(false);
  });

  test('puts the text in the same columns, with the same wrap width', () => {
    expect(sideColumns(patched)).toEqual(sideColumns(stock));
    expect(patched.width).toBe(stock.width);
    expect(patched.children).toEqual(stock.children);
  });
});

describe('the plain box of the chat input', () => {
  const patch = patchNamed(copySelectPatches, 'copy-select-plain-box-no-sides');
  const box = (tail: string, hasBorder: boolean): Box =>
    payloadFunction<unknown[], Box>(
      ['t', 'c', 'Eh', 'a', 'V', 'E'],
      `return t(c,{borderStyle:Eh.hasBorder?"round":void 0,borderColor:Eh.hasBorder?a.border:void 0,${tail}paddingTop:0,paddingBottom:0,children:"rows"})`,
    )(element, 'Box', { hasBorder, paddingX: 1 }, { border: 'gray' }, true, WIDTH);

  test('control: stock draws both side borders', () => {
    expect(sideColumns(box(patch.find, true))).toEqual({ left: 2, right: 2, text: WIDTH - 4 });
  });

  test('with a border, turns the sides off and puts the text in the same columns', () => {
    const patched = box(patch.replace, true);
    expect(patched.borderStyle).toBe('round');
    expect(patched.borderLeft).toBe(false);
    expect(patched.borderRight).toBe(false);
    expect(sideColumns(patched)).toEqual(sideColumns(box(patch.find, true)));
  });

  test('without a border, lays out as stock does', () => {
    const patched = box(patch.replace, false);
    expect(patched.borderStyle).toBeUndefined();
    expect(sideColumns(patched)).toEqual(sideColumns(box(patch.find, false)));
    expect(patched.paddingX).toBe(1);
  });
});

const NAME = String.raw`[\w$]+`;

function edge(side: 'top' | 'bottom'): RegExp {
  return new RegExp(
    String.raw`\(${NAME}\?${NAME}\.${side}Left:""\)\+${NAME}\.${side}\.repeat\(${NAME}\)\+\(${NAME}\?${NAME}\.${side}Right:""\)`,
    'u',
  );
}

describe.skipIf(stockDroid === undefined)('Ink in the shipped binary', () => {
  test.each(['top', 'bottom'] as const)(
    'draws no corner on the %s border when the sides are off',
    (side) => {
      expect(stockText).toMatch(edge(side));
    },
  );

  test('gives a side whose border is off no width', () => {
    expect(stockText).toMatch(
      new RegExp(
        String.raw`setBorder\(${NAME}\.EDGE_LEFT,${NAME}\.borderLeft===!1\?0:${NAME}\)`,
        'u',
      ),
    );
  });
});

const { patchedText, rebasedNamed } = shipped(copySelectPatches);

const SHELL_EDGES = /[╭╮╰╯│]/gu;

function flatShellText(text: string): string {
  return text.replaceAll(SHELL_EDGES, (glyph) => (glyph === '│' ? ' ' : '─'));
}

describe.skipIf(stockDroid === undefined)('the captured early input renderer', () => {
  test('the fixture is the complete shipped function, including all six edges', () => {
    const { source, root, patch } = shippedShell();
    expect(declarationText(source, root)).toBe(patch.find);
    expect([...patch.find.matchAll(/\\u(?:256D|256E|2570|256F|2502)/gu)]).toHaveLength(6);
  });

  test('only replaces the corners and side cells, preserving draft, wrapping, cursor and styles', () => {
    const fixture = shippedShell();
    const stock = shellRenderer(fixture, false);
    const flat = shellRenderer(fixture, true);
    for (const width of [12, 20, 60, 100, 120]) {
      for (const draft of ['', 'hello', 'one\ntwo\nthree', 'a long wrapped draft '.repeat(8)]) {
        for (const cursor of [0, Math.floor(draft.length / 2), draft.length]) {
          const options = {
            handoff: { draft, placeholder: 'Ask anything', cursor },
            width,
            windowsLike: false,
          };
          const rounded = stock(options);
          const straight = flat(options);
          expect(straight).toEqual(
            rounded.map((row) => row.map((span) => ({ ...span, text: flatShellText(span.text) }))),
          );
          expect(
            straight.map((row) => Bun.stringWidth(row.map((span) => span.text).join(''))),
          ).toEqual(rounded.map((row) => Bun.stringWidth(row.map((span) => span.text).join(''))));
          expect(straight.flat().filter((span) => span.style?.inverse === true)).toEqual(
            rounded.flat().filter((span) => span.style?.inverse === true),
          );
        }
      }
    }
  });

  test('leaves the Windows-like branch byte-for-byte unchanged', () => {
    const fixture = shippedShell();
    const stock = shellRenderer(fixture, false);
    const flat = shellRenderer(fixture, true);
    for (const width of [20, 60, 120]) {
      for (const draft of ['', 'typing', 'one\ntwo', 'wrapping '.repeat(20)]) {
        const options = {
          handoff: { draft, placeholder: 'Ask anything', cursor: draft.length },
          width,
          windowsLike: true,
        };
        expect(flat(options)).toEqual(stock(options));
      }
    }
  });

  test('discovers and executes the fixture after the whole module closure is renamed', () => {
    const fixture = shippedShell();
    const closures = [closureOf(fixture.source, [fixture.root]), fixture.layout.closure];
    const names = [...new Set(closures.flatMap((closure) => freeNames(closure)))];
    const renames = new Map(names.map((name, index) => [name, `renamed${index}`]));
    const renamed = closures.map((closure) => renameIn(closure, renames));
    expect(renamed[0]).not.toContain(fixture.patch.find);
    const captured = captureShell(['function unrelated(){return "noise"}', ...renamed]);
    expect(captured.patch.status).toBe('rebased');
    expect(captured.patch.matches).toBe(1);
    expect(renames.get(fixture.root)).toBe(captured.root);
    expect(fixture.parameters.map((name) => renames.get(name))).toEqual(captured.parameters);
    expect(fixture.layout.roots.map((name) => renames.get(name))).toEqual(captured.layout.roots);
    expect(fixture.layout.parameters.map((name) => renames.get(name))).toEqual(
      captured.layout.parameters,
    );
    expect(declarationText(captured.source, captured.root)).toBe(captured.patch.find);
    expect(captured.patch.replace).toBe(renameIn(fixture.patch.replace, renames));
    for (const patched of [false, true]) {
      const render = shellRenderer(captured, patched);
      const original = shellRenderer(fixture, patched);
      for (const windowsLike of [false, true]) {
        for (const width of [20, 60, 120]) {
          const options = {
            handoff: { draft: 'early typing\nnext row', placeholder: 'Ask', cursor: 4 },
            width,
            windowsLike,
          };
          expect(render(options)).toEqual(original(options));
        }
      }
    }
  });
});

describe.skipIf(stockDroid === undefined)('the shipped binary', () => {
  test.each(copySelectPatches.map((patch) => [patch.name] as const))('%s applies once', (name) => {
    const rebase = rebasedNamed(name);
    expect(applies(rebase)).toBe(true);
    expect(rebase.matches).toBe(1);
  });

  test.each(copySelectPatches.map((patch) => [patch.name] as const))(
    '%s is in the patched source',
    (name) => {
      expect(patchedText).toContain(rebasedNamed(name).replace);
    },
  );

  test('the subagent box keeps its bold border and loses its sides, in either patch order', () => {
    for (const list of [
      [...subagentInputPatches, ...copySelectPatches],
      [...copySelectPatches, ...subagentInputPatches],
    ]) {
      const text = joinApp(patchSource(requireStock(), list));
      expect(text).toMatch(
        /borderStyle:\$ODsubagent\?"bold":"round",[^}]*?borderTop:!1,width:[\w$]+,paddingX:2,borderLeft:!1,borderRight:!1,/u,
      );
      expect(text).toContain('.replaceAll("\\u2500","\\u2501")');
    }
  });
});
