import { describe, expect, test } from 'bun:test';

import { DOTTED_NAME } from '../shield-patches.ts';

describe('a dotted name of lowercase words, numbers and short codes reads as words', () => {
  test.each([
    'typography.p22-mackinac-pro.h6-18-bold',
    'typography.p22-mackinac-pro.h1-48-semibold',
    'typography.geist.2xl-36-semibold',
    'colors.brand.500',
    'spacing.4',
    'a.b',
    'db.internal.acme.io',
    'feature-flags.checkout-v2.rollout-pct',
  ])('%s is a dotted name', (value) => {
    expect(DOTTED_NAME.test(value)).toBe(true);
  });

  test.each([
    'p22-mackinac-pro-h6-18-bold',
    '3f2a9c1e-4b1c-4d2e-9a7b-1c2d3e4f5a6b',
    '3f2a9c1e4b1c4d2e9a7b1c2d3e4f5a6b',
    'ab12-cd34-ef56-7a8b-9c0d-e1f2',
    'x9k2.p7q4m8z3w1.r5t6',
    'typography.p22-mackinac-pro.h12345',
    'a1b2c.d',
    'abcdef.9705823469017285',
    'abcdef.qwertyuiopasdfgh',
    '1234567.9876543',
    'typography.abcdefghijklm',
    'Typography.p22-mackinac-pro.h6-18-bold',
    'typography.p22_mackinac.h6',
    'typography..h6',
    '.typography.h6',
    'typography.h6.',
    'typography.h6-',
  ])('%s is not', (value) => {
    expect(DOTTED_NAME.test(value)).toBe(false);
  });

  test('a long failing input is rejected in linear time', () => {
    const started = performance.now();
    expect(DOTTED_NAME.test(`${'ab.'.repeat(5000)}!`)).toBe(false);
    expect(DOTTED_NAME.test(`${'abcdefghijkl-'.repeat(2000)}!`)).toBe(false);
    expect(performance.now() - started).toBeLessThan(200);
  });
});
