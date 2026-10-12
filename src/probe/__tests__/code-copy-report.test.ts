import { describe, expect, test } from 'bun:test';

import { describeCodeCopy, readCodeCopy, withoutStyles } from '../code-copy-report.ts';

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
