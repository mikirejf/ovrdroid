import { describe, expect, test } from 'bun:test';

import { TerminalScreen } from '../terminal-screen.ts';

const ESC = '\u001B';

function shown(cols: number, rows: number, text: string): string[] {
  const screen = new TerminalScreen(cols, rows);
  screen.feed(text);
  return screen.lines();
}

describe('a line longer than the terminal', () => {
  test('wraps onto the next row, and a copy joins the rows into one line', () => {
    expect(shown(10, 5, 'abcdefghijklmnopqrstuvwxyz\r\nnext')).toEqual([
      'abcdefghijklmnopqrstuvwxyz',
      'next',
    ]);
  });

  test('waits at the last column, so an exactly full row does not start a blank row', () => {
    expect(shown(5, 3, 'abcde\r\nxyz')).toEqual(['abcde', 'xyz']);
  });

  test('stays one line when a newline follows a full row', () => {
    expect(shown(5, 3, 'abcdef\r\nxyz')).toEqual(['abcdef', 'xyz']);
  });

  test('is cut at the right edge while wrapping is off', () => {
    expect(shown(5, 3, `${ESC}[?7labcdefgh${ESC}[?7h`)).toEqual(['abcdh']);
  });
});

describe('moving the cursor', () => {
  test('erases the rows a redraw climbs over', () => {
    const frame = 'one\r\ntwo\r\nthree';
    const redraw = `${ESC}[G${ESC}[K${ESC}[1A${ESC}[K${ESC}[1A${ESC}[K`;
    expect(shown(20, 5, `${frame}${redraw}new`)).toEqual(['new']);
  });

  test('leaves the start of an old wrapped line when the redraw climbs too few rows', () => {
    const frame = 'head\r\nabcdefghijkl';
    const redraw = `${ESC}[G${ESC}[K${ESC}[1A${ESC}[K`;
    expect(shown(5, 6, `${frame}${redraw}new`)).toEqual(['head', 'abcdenew']);
  });

  test('puts the cursor at a row and column', () => {
    expect(shown(10, 4, `${ESC}[3;4Hx`)).toEqual(['', '', '   x']);
  });
});

describe('scrolling and clearing', () => {
  test('keeps the rows that scroll off the top', () => {
    expect(shown(10, 2, 'a\r\nb\r\nc\r\nd')).toEqual(['a', 'b', 'c', 'd']);
  });

  test('drops the scrollback on a full clear', () => {
    const text = `a\r\nb\r\nc\r\nd${ESC}[2J${ESC}[3J${ESC}[Hfresh`;
    expect(shown(10, 2, text)).toEqual(['fresh']);
  });

  test('ignores colours, window titles and mode switches', () => {
    const text = `${ESC}[?2026h${ESC}[38;2;1;2;3mred${ESC}[39m${ESC}]0;title\u0007 ok${ESC}[?25l`;
    expect(shown(20, 2, text)).toEqual(['red ok']);
  });
});

describe('resizing', () => {
  test('repaints at the new width', () => {
    const screen = new TerminalScreen(5, 3);
    screen.feed('abcdefgh');
    screen.resize(10, 3);
    screen.feed(`${ESC}[2J${ESC}[3J${ESC}[Habcdefgh`);
    expect(screen.lines()).toEqual(['abcdefgh']);
  });
});

function styled(text: string, cols = 20, rows = 4) {
  const screen = new TerminalScreen(cols, rows);
  screen.feed(text);
  return screen.styledLines();
}

describe('styled lines', () => {
  test('records the foreground and background each character was drawn with', () => {
    const [line] = styled(`${ESC}[38;2;1;2;3;48;5;9mab${ESC}[0mc`);
    expect(line?.text).toBe('abc');
    expect(line?.fgs).toEqual(['38;2;1;2;3', '38;2;1;2;3', '']);
    expect(line?.bgs).toEqual(['48;5;9', '48;5;9', '']);
  });

  test('reads basic colours and the default-colour resets', () => {
    const [line] = styled(`${ESC}[31;42ma${ESC}[39mb${ESC}[49mc`);
    expect(line?.fgs).toEqual(['31', '', '']);
    expect(line?.bgs).toEqual(['42', '42', '']);
  });

  test('keeps the colours when a cursor move redraws part of a row', () => {
    const [line] = styled(`abcd${ESC}[3G${ESC}[32mX`);
    expect(line?.text).toBe('abXd');
    expect(line?.fgs).toEqual(['', '', '32', '']);
  });

  test('erased cells lose their colour', () => {
    const [line] = styled(`${ESC}[31mabc${ESC}[0m${ESC}[2G${ESC}[K`);
    expect(line?.text).toBe('a');
    expect(line?.fgs).toEqual(['31']);
  });

  test('lines up with the text of lines()', () => {
    const screen = new TerminalScreen(5, 3);
    screen.feed(`${ESC}[31mabcdefgh${ESC}[0m\r\nx`);
    expect(screen.styledLines().map((line) => line.text)).toEqual(screen.lines());
    expect(screen.styledLines()[0]?.fgs).toHaveLength(8);
  });

  test('gives a double-width character one colour entry', () => {
    const [line] = styled(`${ESC}[33m漢${ESC}[0mz`);
    expect(line?.text).toBe('漢z');
    expect(line?.fgs).toEqual(['33', '']);
  });
});
