import { describe, expect, test } from 'bun:test';

import { cutOffVerdict, describeRequests, readCutOff } from '../cut-off-report.ts';
import { STUB_END } from '../stub-model.ts';

const HALF = 'A long answer about a small pipeline\n first section';
const FULL = `${HALF}\n${STUB_END}`;

describe('cutOffVerdict', () => {
  test('passes when the cut stream was asked for again and the full reply showed', () => {
    const verdict = cutOffVerdict(readCutOff(['title', 'cut', 'full'], [HALF, FULL]));

    expect(verdict.pass).toBe(true);
    expect(verdict.reason).toContain('2 requests');
  });

  test('title requests are not counted as asking again', () => {
    const verdict = cutOffVerdict(readCutOff(['title', 'cut', 'title'], [HALF]));

    expect(verdict.pass).toBe(false);
    expect(verdict.reason).toContain('kept the half reply');
  });

  test('fails when Droid kept the half reply after one request', () => {
    const verdict = cutOffVerdict(readCutOff(['title', 'cut'], [HALF]));

    expect(verdict.pass).toBe(false);
    expect(verdict.reason).toContain('kept the half reply');
  });

  test('fails when Droid retried but the full reply never showed', () => {
    const verdict = cutOffVerdict(readCutOff(['title', 'cut', 'full'], [HALF]));

    expect(verdict.pass).toBe(false);
    expect(verdict.reason).toContain('never showed');
  });

  test('fails as not exercised when the first stream ended cleanly', () => {
    const verdict = cutOffVerdict(readCutOff(['title', 'full'], [FULL]));

    expect(verdict.pass).toBe(false);
    expect(verdict.reason).toContain('did not exercise a cut-off reply');
  });

  test('fails when the stub was never asked', () => {
    const verdict = cutOffVerdict(readCutOff([], []));

    expect(verdict.pass).toBe(false);
    expect(verdict.reason).toContain('never asked');
  });
});

describe('describeRequests', () => {
  test('lists what the stub served in order', () => {
    expect(describeRequests(['cut', 'full'])).toBe('the stub received 2 requests: cut, full');
    expect(describeRequests(['cut'])).toBe('the stub received 1 request: cut');
  });
});
