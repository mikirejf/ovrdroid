import { describe, expect, test } from 'bun:test';

import { describeEffort, effortHeld, labelOf, readEffort } from '../effort.ts';
import type { Frame } from '../session.ts';

function status(effort: string): string {
  return `╰────╯\n? for help\nAuto (High) · allow all commands       DroidProxy: Opus 5.5 (${effort})\n`;
}

function frame(atMs: number, text: string): Frame {
  return { atMs, text };
}

describe('labelOf', () => {
  test('reads the model effort, not the autonomy level on the same line', () => {
    expect(labelOf(status('Extra high'))).toBe('Extra high');
  });

  test('finds nothing on a frame without the status line', () => {
    expect(labelOf('╭────╮\n│ > hi │\n╰────╯')).toBeUndefined();
  });
});

describe('readEffort', () => {
  test('stock startup: the label moves at once and stays', () => {
    const reading = readEffort('High', [
      frame(40, status('High')),
      frame(52, status('Extra high')),
      frame(900, 'spinner only'),
    ]);

    expect(reading).toEqual({ before: 'High', changedMs: 52, final: 'Extra high' });
    expect(effortHeld(reading)).toBe(true);
    expect(describeEffort(reading)).toContain('stayed at "Extra high"');
  });

  test('a press queued behind the session load moves the label late', () => {
    const reading = readEffort('High', [frame(10, status('High')), frame(2862, status('Medium'))]);

    expect(effortHeld(reading)).toBe(false);
    expect(describeEffort(reading)).toContain('moved only 2862ms');
  });

  test('stock /clear: the change shows, then the new session wipes it', () => {
    const reading = readEffort('Medium', [
      frame(12, status('Medium')),
      frame(69, status('High')),
      frame(2075, status('Medium')),
    ]);

    expect(reading.final).toBe('Medium');
    expect(effortHeld(reading)).toBe(false);
    expect(describeEffort(reading)).toContain('the change was lost');
  });

  test('a press that never lands says so', () => {
    const reading = readEffort('High', [frame(10, status('High'))]);

    expect(reading.changedMs).toBeUndefined();
    expect(describeEffort(reading)).toContain('ignored');
  });
});
