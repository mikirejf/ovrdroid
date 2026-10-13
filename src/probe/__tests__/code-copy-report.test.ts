import { describe, expect, test } from 'bun:test';

import {
  conversationAbove,
  describeCodeCopy,
  describeInlineCode,
  describeLiveFrames,
  describeRedraw,
  describeWideCommand,
  liveFramesClipped,
  readCodeCopy,
  readRedraw,
  readWideCommand,
  screensOf,
  withoutStyles,
} from '../code-copy-report.ts';

const COMMAND =
  'curl -fsSL "https://example.com/releases/tool.tar.gz" -o /tmp/tool.tgz --wildcards';
const ESC = '\u001B';

describe('readCodeCopy', () => {
  test('reads a command that keeps only colour codes inside it as unbroken', () => {
    const colored = `${ESC}[38;2;1;2;3mcurl${ESC}[39m -fsSL "https://example.com/releases/tool.tar.gz" -o /tmp/tool.tgz --wildcards`;
    const reading = readCodeCopy(`   ${colored}\r\n   tool --version\r\n`, COMMAND);
    expect(reading).toEqual({ printed: true, intactCopies: 1, lastIntact: true });
  });

  test('shows the newline and indent Droid wrote where the command breaks', () => {
    const raw = `     curl -fsSL "https://example.com/releases/tool.tar.gz" -o\r\n     /tmp/tool.tgz --wildcards\r\n`;
    const reading = readCodeCopy(raw, COMMAND);
    expect(reading.lastIntact).toBe(false);
    expect(reading.brokenAfter).toBe(COMMAND.indexOf(' /tmp'));
    expect(reading.gap).toBe(String.raw`\r\n    `);
  });

  test('catches a cursor move inside the command', () => {
    const raw = `curl -fsSL "https://example.com/rel${ESC}[1A${ESC}[Keases/tool.tar.gz" -o /tmp/tool.tgz --wildcards`;
    const reading = readCodeCopy(raw, COMMAND);
    expect(reading.lastIntact).toBe(false);
    expect(reading.gap).toBe(String.raw`\u001b[1A\u001b[K`);
  });

  test('judges the last copy, because live frames before it are erased', () => {
    const live = `curl -fsSL "https://example.com/rel\r\neases/tool.tar.gz" -o /tmp/tool.tgz --wildcards\r\n`;
    const reading = readCodeCopy(`${live}${ESC}[2A${ESC}[K${COMMAND}\r\n`, COMMAND);
    expect(reading.lastIntact).toBe(true);
    expect(reading.intactCopies).toBe(1);
  });

  test('reports a command that never reached the terminal', () => {
    expect(readCodeCopy('nothing here', COMMAND)).toEqual({
      printed: false,
      intactCopies: 0,
      lastIntact: false,
    });
  });

  test('shows a no-break space Droid wrote where the command has a plain space', () => {
    const reading = readCodeCopy(
      'git push --no-verify\u00A0-u origin main',
      'git push --no-verify -u origin main',
    );
    expect(reading.lastIntact).toBe(false);
    expect(reading.brokenAfter).toBe('git push --no-verify'.length);
    expect(reading.gap).toStartWith(String.raw`\u00a0`);
  });

  test('drops hyperlink sequences along with colours', () => {
    expect(withoutStyles(`${ESC}]8;;https://x${ESC}\\link${ESC}]8;;${ESC}\\`)).toBe('link');
  });
});

describe('describeCodeCopy', () => {
  test('says where the copy breaks and what Droid wrote there', () => {
    const line = describeCodeCopy(
      {
        printed: true,
        intactCopies: 0,
        lastIntact: false,
        brokenAfter: 72,
        gap: String.raw`\r\n  `,
      },
      COMMAND,
      'after the reply',
    );
    expect(line).toBe(
      String.raw`after the reply: the last copy breaks after 72 of 82 chars, where Droid wrote "\r\n  ", so a copy carries that break into the shell`,
    );
  });
});

describe('describeInlineCode', () => {
  test('says the command stays on one line with plain spaces', () => {
    const line = describeInlineCode(
      { printed: true, intactCopies: 1, lastIntact: true },
      COMMAND,
      'after the reply',
    );
    expect(line).toBe(
      'after the reply: the 82-char inline command sits on one line with plain spaces, so a copy pastes into a shell whole',
    );
  });

  test('says where the command breaks and what Droid wrote instead of a space', () => {
    const line = describeInlineCode(
      {
        printed: true,
        intactCopies: 0,
        lastIntact: false,
        brokenAfter: 3,
        gap: String.raw`\u00a0`,
      },
      COMMAND,
      'after the reply',
    );
    expect(line).toBe(
      String.raw`after the reply: the inline command breaks after 3 of 82 chars, where Droid wrote "\u00a0" instead of a plain space, so a copy carries that into the shell`,
    );
  });

  test('reports a command that never reached the terminal', () => {
    const line = describeInlineCode(
      { printed: false, intactCopies: 0, lastIntact: false },
      COMMAND,
      'after the reply',
    );
    expect(line).toBe('after the reply: Droid never printed the inline command');
  });
});

const LIVE_FOOTER = ' Auto (High) · allow all commands';
const FRAME = `${ESC}[?2026h`;

describe('readWideCommand', () => {
  test('counts the lines that hold the whole command and the rows the terminal gives it', () => {
    const lines = ['intro', `   ${COMMAND}`, 'outro'];
    expect(readWideCommand(lines, COMMAND, 40)).toEqual({ lines: 1, rows: 3 });
  });

  test('finds no line when Droid broke the command', () => {
    const lines = [COMMAND.slice(0, 40), COMMAND.slice(40)];
    expect(readWideCommand(lines, COMMAND, 80)).toEqual({ lines: 0, rows: 0 });
  });
});

describe('describeWideCommand', () => {
  test('says the terminal wraps the one line over its rows', () => {
    expect(describeWideCommand({ lines: 1, rows: 2 }, COMMAND, 'on the screen')).toBe(
      'on the screen: the 82-char command is one line that the terminal wraps over 2 rows, so a terminal copy takes it whole',
    );
  });

  test('says a broken command leaves no single line', () => {
    expect(describeWideCommand({ lines: 0, rows: 0 }, COMMAND, 'on the screen')).toBe(
      'on the screen: no single line on screen holds the 82-char command, so a terminal copy carries a break',
    );
  });

  test('says a second copy means a redraw left one behind', () => {
    expect(describeWideCommand({ lines: 2, rows: 2 }, COMMAND, 'on the screen')).toBe(
      'on the screen: 2 lines on screen hold the 82-char command, so a redraw left a copy behind',
    );
  });
});

describe('readRedraw', () => {
  const repainted = ['one', 'two', LIVE_FOOTER, 'box'];

  test('treats the conversation above the live area as the part to compare', () => {
    expect(conversationAbove([...repainted, 'more'])).toEqual(['one', 'two']);
  });

  test('drops a spinner line and blank lines that sit right above the live area', () => {
    const lines = ['one', '', ' ⠙ Streaming...  (Press ESC to stop)', '', LIVE_FOOTER];
    expect(conversationAbove(lines)).toEqual(['one']);
  });

  test('reads a screen that matches the repaint as clean, whatever the live area shows', () => {
    const live = ['one', 'two', LIVE_FOOTER, 'a different box'];
    expect(readRedraw(live, repainted)).toEqual({ rows: 2, same: true });
  });

  test('names the first line where a redraw left garbage', () => {
    const live = ['one', 'one', 'two', LIVE_FOOTER];
    const reading = readRedraw(live, repainted);
    expect(reading).toEqual({
      rows: 2,
      same: false,
      differsAt: 1,
      shown: 'one',
      repainted: 'two',
    });
    expect(describeRedraw(reading, 'after the reply')).toBe(
      'after the reply: the conversation on screen differs from a full repaint at line 1 (screen "one", repaint "two"), so a redraw left garbage',
    );
  });

  test('says a clean screen left no stray or doubled rows', () => {
    expect(describeRedraw({ rows: 44, same: true }, 'after the reply')).toBe(
      'after the reply: the 44 lines of conversation on screen match a full repaint at the same width, so the live redraws left no stray or doubled rows',
    );
  });
});

describe('liveFramesClipped', () => {
  const cols = 40;
  const clipped = COMMAND.slice(0, cols - 3);

  test('counts the frames that draw the command cut at the terminal edge', () => {
    const reply = [
      `${FRAME}   ${ESC}[1m${clipped}${ESC}[22m\r\nfooter`,
      `${FRAME}${ESC}[1A${ESC}[K   ${clipped}\r\nfooter`,
      `${FRAME}   ${COMMAND}\r\nfooter`,
      `${FRAME}nothing about it\r\n`,
    ].join('');
    expect(liveFramesClipped(reply, COMMAND, cols)).toBe(2);
  });

  test('ignores a frame that wraps the command into shorter lines', () => {
    const reply = `${FRAME}   ${COMMAND.slice(0, 30)}\r\n   ${COMMAND.slice(30)}\r\n`;
    expect(liveFramesClipped(reply, COMMAND, cols)).toBe(0);
  });

  test('says a run with no live frame proves nothing about the redraw', () => {
    expect(describeLiveFrames(0, COMMAND, cols)).toBe(
      'no live frame drew the 82-char command, so the redraw check proves nothing: slow the stream down',
    );
    expect(describeLiveFrames(20, COMMAND, cols)).toBe(
      '20 live frames drew the 82-char command cut at column 40, so the redraw never held a line wider than the terminal',
    );
  });
});

describe('screensOf', () => {
  const size = { cols: 10, rows: 4, resizeTo: 20 };

  test('replays the launch, the reply, the repaint and the resize on one screen', () => {
    const screens = screensOf(
      {
        launch: 'banner\r\n',
        reply: `${COMMAND.slice(0, 25)}\r\n`,
        repaint: `${ESC}[2J${ESC}[3J${ESC}[Hbanner\r\n${COMMAND.slice(0, 25)}\r\n`,
        resize: `${ESC}[2J${ESC}[3J${ESC}[Hbanner\r\n${COMMAND.slice(0, 25)}\r\n`,
      },
      size,
    );
    expect(screens.live).toEqual(['banner', COMMAND.slice(0, 25)]);
    expect(screens.repainted).toEqual(screens.live);
    expect(screens.resized).toEqual(screens.live);
  });
});
