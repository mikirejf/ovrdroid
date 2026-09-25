import { describe, expect, test } from 'bun:test';

import { describeFirstSend, readFirstSend } from '../first-send.ts';
import type { Frame } from '../session.ts';

const TEXT = 'Reply with ok';

function box(input: string): string {
  return `╭────╮\n│ > ${input}   │\n╰────╯`;
}

function frame(atMs: number, text: string): Frame {
  return { atMs, text };
}

describe('readFirstSend', () => {
  test('stock: the message waits for the session, then the reply arrives', () => {
    const reading = readFirstSend(
      [
        frame(10, box(TEXT)),
        frame(40, box('')),
        frame(6200, `> ${TEXT}\n Thinking...  (Press ESC to stop)\n${box('')}`),
        frame(8100, `> ${TEXT}\n⛬  ok\n${box('')}`),
      ],
      TEXT,
    );

    expect(reading).toEqual({ echoMs: 6200, spinnerMs: 6200, replyMs: 8100, queued: false });
    expect(describeFirstSend(reading)).toContain('the turn ran');
  });

  test('patched: the message and the spinner show in the first frame', () => {
    const reading = readFirstSend(
      [
        frame(30, `> ${TEXT}\n Thinking...  (Press ESC to stop)\n${box('')}`),
        frame(7000, `⛬  ok.\n${box('')}`),
      ],
      TEXT,
    );

    expect(reading.echoMs).toBe(30);
    expect(reading.spinnerMs).toBe(30);
    expect(reading.replyMs).toBe(7000);
  });

  test('any working label counts as the spinner', () => {
    const reading = readFirstSend(
      [
        frame(20, `> ${TEXT}\n${box('')}`),
        frame(90, `> ${TEXT}\n Streaming...  (Press ESC to stop)\n${box('')}`),
      ],
      TEXT,
    );

    expect(reading.echoMs).toBe(20);
    expect(reading.spinnerMs).toBe(90);
    expect(describeFirstSend(reading)).toContain('the working spinner showed 90ms after Enter');
  });

  test('a label without the stop hint is not the spinner', () => {
    const reading = readFirstSend([frame(20, `> ${TEXT}\nThinking...\n${box('')}`)], TEXT);

    expect(reading.spinnerMs).toBeUndefined();
  });

  test('the text in the input box does not count as shown', () => {
    const reading = readFirstSend([frame(10, box(TEXT))], TEXT);

    expect(reading.echoMs).toBeUndefined();
    expect(describeFirstSend(reading)).toContain('did not run');
  });

  test('a queued notice is flagged', () => {
    const reading = readFirstSend([frame(10, `> ${TEXT}\n1 message queued\n${box('')}`)], TEXT);

    expect(reading.queued).toBe(true);
    expect(describeFirstSend(reading)).toContain('waited behind a busy session');
  });
});
