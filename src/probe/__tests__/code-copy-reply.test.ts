import { describe, expect, test } from 'bun:test';

import {
  copyReply,
  INLINE_REPLY_COMMAND,
  INLINE_RESIZE_COMMAND,
  inlineParagraph,
} from '../code-copy-reply.ts';

const WIDTHS = [80, 100];

describe('inlineParagraph', () => {
  test.each(WIDTHS)('puts the command across the end of a %i-column line', (width) => {
    const lead = inlineParagraph(INLINE_REPLY_COMMAND, width).indexOf('`');
    const indent = 3;
    expect(lead).toBeLessThan(width - indent);
    expect(lead + INLINE_REPLY_COMMAND.length).toBeGreaterThan(width);
  });

  test('keeps the lead-in on one line', () => {
    const text = inlineParagraph(INLINE_RESIZE_COMMAND, 100);
    expect(text.indexOf('`')).toBeLessThan(100);
    expect(text).not.toContain('\n');
  });

  test('writes the command as inline code, spaces included', () => {
    expect(inlineParagraph(INLINE_REPLY_COMMAND, 80)).toContain(`\`${INLINE_REPLY_COMMAND}\``);
  });
});

describe('copyReply', () => {
  const reply = copyReply(80, 100);

  test('carries both inline commands once, so each reading judges its own copy', () => {
    expect(reply.split(INLINE_REPLY_COMMAND)).toHaveLength(2);
    expect(reply.split(INLINE_RESIZE_COMMAND)).toHaveLength(2);
  });

  test('gives the two inline commands different openings, so a reading cannot mistake one for the other', () => {
    expect(INLINE_REPLY_COMMAND.slice(0, 16)).not.toBe(INLINE_RESIZE_COMMAND.slice(0, 16));
  });
});
