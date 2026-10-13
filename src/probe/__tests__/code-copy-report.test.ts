import { describe, expect, test } from 'bun:test';

import {
  describeCodeCopy,
  describeInlineCode,
  readCodeCopy,
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
