import { describe, expect, test } from 'bun:test';

import { blankRowsAtBottom, screenOf } from '../../probe/frame-gap-report.ts';
import { moduleHolding, rebased, renamed, sourceApp, STOCK, textOf } from './ink-frame-harness.ts';
import { closureOf } from './module-closure.ts';
import { evaluateProgram } from './stream-render-harness.ts';

const COLS = 30;
const ROWS = 10;
const ESC = String.fromCodePoint(0x1b);

interface Anchor {
  $ODtop?: number;
  $ODh?: number;
}

type ShrinkPad = (
  ...args: [state: Anchor, frame: string, staticText: string, cols: number, rows: number]
) => number;

function shrinkPad(): ShrinkPad {
  const rebase = rebased('ink-shrink-repaint-helpers');
  const text = textOf(sourceApp(), moduleHolding(sourceApp(), rebase.find));
  const helpers = rebase.replace.slice(0, rebase.replace.lastIndexOf('class '));
  return evaluateProgram<{ $ODshrinkPad: ShrinkPad }>({
    moduleText: text,
    source: `${closureOf(text, [renamed(rebase, 'Xa')])};${helpers}`,
    returns: ['$ODshrinkPad'],
    overrides: new Map(),
  }).$ODshrinkPad;
}

function eraseLines(count: number): string {
  let out = '';
  for (let line = 0; line < count; line += 1) {
    out += `${ESC}[2K${line < count - 1 ? `${ESC}[1A` : ''}`;
  }
  return count > 0 ? `${out}${ESC}[G` : '';
}

function frameOf(name: string, lines: number): string {
  return `${Array.from({ length: lines }, (_line, index) => `${name} row ${index}`).join('\n')}\n`;
}

function staticOf(from: number, lines: number): string {
  return `${Array.from({ length: lines }, (_line, index) => `history ${from + index}`).join('\n')}\n`;
}

class Terminal {
  output = '';
  pads: number[] = [];
  private readonly state: Anchor = {};
  private previousLines = 0;
  private readonly pad: ShrinkPad | undefined;

  constructor(pad?: ShrinkPad) {
    this.pad = pad;
  }

  render(frame: string, staticText = ''): void {
    const pad = this.pad?.(this.state, frame, staticText, COLS, ROWS) ?? 0;
    this.pads.push(pad);
    const written = `${'\n'.repeat(pad)}${frame}`;
    this.output += `${eraseLines(this.previousLines)}${staticText}${written}`.replaceAll(
      '\n',
      '\r\n',
    );
    this.previousLines = written.split('\n').length;
  }

  bottomBlank(): number {
    return blankRowsAtBottom(this.output, COLS, ROWS);
  }

  historyCounts(): Map<string, number> {
    const counts = new Map<string, number>();
    for (const line of screenOf(this.output, COLS, ROWS).lines()) {
      if (line.startsWith('history ')) {
        counts.set(line, (counts.get(line) ?? 0) + 1);
      }
    }
    return counts;
  }
}

function filled(pad?: ShrinkPad): Terminal {
  const terminal = new Terminal(pad);
  terminal.render(frameOf('busy', 4));
  terminal.render(frameOf('busy', 4), staticOf(0, 12));
  return terminal;
}

describe.skipIf(STOCK === undefined)('ink-shrink-repaint', () => {
  test('stock leaves the rows a shrinking frame gave up blank under the footer', () => {
    const terminal = filled();
    expect(terminal.bottomBlank()).toBe(1);
    terminal.render(frameOf('idle', 2));
    expect(terminal.bottomBlank()).toBe(3);
  });

  test('a frame on the bottom row that shrinks is padded back down to it', () => {
    const terminal = filled(shrinkPad());
    terminal.render(frameOf('idle', 2));
    expect(terminal.pads.at(-1)).toBe(2);
    expect(terminal.bottomBlank()).toBe(1);
  });

  test('a frame that never reached the bottom row is left where it is', () => {
    const terminal = new Terminal(shrinkPad());
    terminal.render(frameOf('busy', 4));
    terminal.render(frameOf('idle', 2));
    expect(terminal.pads).toEqual([0, 0]);
    expect(screenOf(terminal.output, COLS, ROWS).lines()).toEqual(['idle row 0', 'idle row 1']);
  });

  test('static output written above the frame uses up the padding and is kept once', () => {
    const terminal = filled(shrinkPad());
    terminal.render(frameOf('idle', 2));
    terminal.render(frameOf('idle', 2), staticOf(12, 1));
    expect(terminal.pads.at(-1)).toBe(1);
    terminal.render(frameOf('idle', 2), staticOf(13, 3));
    expect(terminal.pads.at(-1)).toBe(0);
    expect(terminal.bottomBlank()).toBe(1);
    const counts = terminal.historyCounts();
    expect(counts.size).toBe(16);
    expect([...counts.values()].every((count) => count === 1)).toBe(true);
  });

  test('a frame that grows back takes the padding rows and stays on the bottom', () => {
    const terminal = filled(shrinkPad());
    terminal.render(frameOf('idle', 2));
    terminal.render(frameOf('busy', 5));
    expect(terminal.pads.at(-1)).toBe(0);
    expect(terminal.bottomBlank()).toBe(1);
    terminal.render(frameOf('idle', 2));
    expect(terminal.pads.at(-1)).toBe(3);
    expect(terminal.bottomBlank()).toBe(1);
  });

  test('a frame as tall as the screen is never padded', () => {
    const terminal = filled(shrinkPad());
    terminal.render(frameOf('tall', ROWS + 3));
    expect(terminal.pads.at(-1)).toBe(0);
    terminal.render(frameOf('tall', ROWS + 1));
    expect(terminal.pads.at(-1)).toBe(0);
  });
});
