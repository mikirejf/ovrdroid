import { describe, expect, test } from 'bun:test';

import {
  CANCELLED_TEXT,
  describeEscape,
  escapeVerdict,
  readEscape,
  REPLY_OPENING,
  STOP_HINT,
} from '../escape-report.ts';
import { STUB_END } from '../stub-model.ts';

const WORKING = `${REPLY_OPENING}\n Working...  ${STOP_HINT}`;
const RUNNING = `${REPLY_OPENING}\n first section`;
const DONE = `${REPLY_OPENING}\n first section\n${STUB_END}`;
const CANCELLED = `${REPLY_OPENING}\n first section\n${CANCELLED_TEXT}`;

describe('escapeVerdict', () => {
  test('passes when the reply finished and nothing was cancelled', () => {
    const verdict = escapeVerdict(readEscape([RUNNING, DONE]));

    expect(verdict.pass).toBe(true);
    expect(verdict.reason).toContain('Esc left the turn running');
    expect(verdict.hintShown).toBe(false);
  });

  test('fails when Esc stopped the turn', () => {
    const verdict = escapeVerdict(readEscape([RUNNING, CANCELLED]));

    expect(verdict.pass).toBe(false);
    expect(verdict.reason).toContain('Esc stopped the turn');
  });

  test('a cancelled notice fails even when the last line also showed', () => {
    const verdict = escapeVerdict(readEscape([DONE, CANCELLED]));

    expect(verdict.pass).toBe(false);
    expect(verdict.reason).toContain('Esc stopped the turn');
  });

  test('fails when the turn never started', () => {
    const verdict = escapeVerdict(readEscape(['nothing here', '']));

    expect(verdict.pass).toBe(false);
    expect(verdict.reason).toBe('the turn never started, so nothing was tested');
  });

  test('fails when the reply never finished and nothing was cancelled', () => {
    const verdict = escapeVerdict(readEscape([RUNNING]));

    expect(verdict.pass).toBe(false);
    expect(verdict.reason).toContain('the turn did not finish');
  });
});

describe('describeEscape', () => {
  test('reports the stop hint when it showed during the turn', () => {
    const verdict = escapeVerdict(readEscape([WORKING, DONE]));

    expect(verdict.hintShown).toBe(true);
    expect(describeEscape(verdict)).toBe(
      `PASS  ${verdict.reason}\n"${STOP_HINT}" showed on screen while the turn ran`,
    );
  });

  test('reports a missing stop hint on a failing run', () => {
    const text = describeEscape(escapeVerdict(readEscape([CANCELLED])));

    expect(text).toStartWith('FAIL  Esc stopped the turn');
    expect(text).toContain(`"${STOP_HINT}" never showed on screen`);
  });
});
