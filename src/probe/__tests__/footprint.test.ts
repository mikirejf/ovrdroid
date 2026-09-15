import { describe, expect, test } from 'bun:test';

import { parseFootprint } from '../footprint.ts';

const SUMMARY = [
  'Process:         droid [51619]',
  'Physical footprint:         179.5M',
  'Physical footprint (peak):  243.4M',
  '----',
].join('\n');

describe('parseFootprint reads the number that counts real memory', () => {
  test('megabytes become kibibytes', () => {
    expect(parseFootprint(SUMMARY)).toBeCloseTo(179.5 * 1024, 0);
  });

  test('the peak line is not mistaken for the current one', () => {
    expect(parseFootprint(SUMMARY)).toBeLessThan(243.4 * 1024);
  });

  test('gigabytes and kibibytes scale too', () => {
    expect(parseFootprint('Physical footprint:  1.5G')).toBe(1.5 * 1024 * 1024);
    expect(parseFootprint('Physical footprint:  512K')).toBe(512);
  });

  test('a listing without the line yields nothing rather than zero', () => {
    expect(parseFootprint('Process: droid [1]')).toBeUndefined();
    expect(parseFootprint('')).toBeUndefined();
  });
});
