import { describe, expect, test } from 'bun:test';

import { describeTyping, keysInBox, readTyping } from '../typing.ts';

describe('keysInBox', () => {
  test('counts the typed key only inside the input box rows', () => {
    const lines = ['Zed says hi', '╭────╮', '│ > ZZZ   │', '│ ZZ      │', '╰────╯'];

    expect(keysInBox(lines)).toBe(5);
  });

  test('is zero before anything is typed', () => {
    expect(keysInBox(['╭──╮', '│ >  │', '╰──╯'])).toBe(0);
  });
});

describe('readTyping', () => {
  test('finds the key that waited longest to show', () => {
    const reading = readTyping([100, 200, 300, 400], [150, 10_300, 10_300, 10_450]);

    expect(reading.firstEchoMs).toBe(150);
    expect(reading.maxLagMs).toBe(10_100);
    expect(reading.maxLagAtMs).toBe(200);
    expect(reading.shown).toBe(4);
  });

  test('a key that never showed stalls forever', () => {
    const reading = readTyping([100, 200], [150]);

    expect(reading.maxLagMs).toBe(Number.POSITIVE_INFINITY);
    expect(reading.maxLagAtMs).toBe(200);
    expect(describeTyping(reading)).toContain('1 of 2 keys never showed');
  });

  test('says so when no key ever reached the box', () => {
    expect(describeTyping(readTyping([100], []))).toContain('no key ever reached the input box');
  });
});
