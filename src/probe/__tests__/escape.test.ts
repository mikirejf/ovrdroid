import { describe, expect, test } from 'bun:test';

import {
  CANCELLED_TEXT,
  describeVerdict,
  doubleEscapeVerdict,
  hintVerdict,
  readEscape,
  REPLY_OPENING,
  REWIND_MENU,
  rewindVerdict,
  singleEscapeVerdict,
  STOCK_STOP_HINT,
  STOP_HINT,
} from '../escape-report.ts';
import { STUB_END } from '../stub-model.ts';

const WORKING = `${REPLY_OPENING}\n Working...  ${STOP_HINT}`;
const RUNNING = `${REPLY_OPENING}\n first section`;
const DONE = `${REPLY_OPENING}\n first section\n${STUB_END}`;
const CANCELLED = `${REPLY_OPENING}\n first section\n${CANCELLED_TEXT}`;

describe('singleEscapeVerdict', () => {
  test('passes when the reply finished and nothing was cancelled', () => {
    const verdict = singleEscapeVerdict(readEscape([RUNNING, DONE]));

    expect(verdict.pass).toBe(true);
    expect(verdict.reason).toContain('one Esc left the turn running');
  });

  test('fails when one Esc stopped the turn', () => {
    const verdict = singleEscapeVerdict(readEscape([RUNNING, CANCELLED]));

    expect(verdict.pass).toBe(false);
    expect(verdict.reason).toContain('one Esc stopped the turn');
  });

  test('a cancelled notice fails even when the last line also showed', () => {
    const verdict = singleEscapeVerdict(readEscape([DONE, CANCELLED]));

    expect(verdict.pass).toBe(false);
    expect(verdict.reason).toContain('one Esc stopped the turn');
  });

  test('fails when the turn never started', () => {
    const verdict = singleEscapeVerdict(readEscape(['nothing here', '']));

    expect(verdict.pass).toBe(false);
    expect(verdict.reason).toBe('the turn never started, so nothing was tested');
  });

  test('fails when the reply never finished and nothing was cancelled', () => {
    const verdict = singleEscapeVerdict(readEscape([RUNNING]));

    expect(verdict.pass).toBe(false);
    expect(verdict.reason).toContain('the turn did not finish');
  });
});

describe('doubleEscapeVerdict', () => {
  test('passes when the cancelled notice showed', () => {
    const verdict = doubleEscapeVerdict(readEscape([RUNNING, CANCELLED]));

    expect(verdict.pass).toBe(true);
    expect(verdict.reason).toContain('two quick Esc presses stopped the turn');
  });

  test('fails when the reply ran to its last line', () => {
    const verdict = doubleEscapeVerdict(readEscape([RUNNING, DONE]));

    expect(verdict.pass).toBe(false);
    expect(verdict.reason).toContain('did not stop the turn: the full reply showed');
  });

  test('fails when nothing was cancelled and the reply did not finish', () => {
    const verdict = doubleEscapeVerdict(readEscape([RUNNING]));

    expect(verdict.pass).toBe(false);
    expect(verdict.reason).toContain('the reply did not finish either');
  });

  test('fails when the turn never started', () => {
    const verdict = doubleEscapeVerdict(readEscape(['nothing here']));

    expect(verdict.pass).toBe(false);
    expect(verdict.reason).toBe('the turn never started, so nothing was tested');
  });
});

describe('hintVerdict', () => {
  test('passes when the twice hint showed during the turn', () => {
    const verdict = hintVerdict(readEscape([WORKING, DONE]));

    expect(verdict.pass).toBe(true);
    expect(describeVerdict(verdict)).toBe(
      `PASS  "${STOP_HINT}" showed on screen while the turn ran`,
    );
  });

  test('fails on the stock hint', () => {
    const stock = `${REPLY_OPENING}\n Working...  ${STOCK_STOP_HINT}`;
    const verdict = hintVerdict(readEscape([stock, DONE]));

    expect(verdict.pass).toBe(false);
    expect(describeVerdict(verdict)).toBe(`FAIL  "${STOP_HINT}" never showed on screen`);
  });
});

describe('rewindVerdict', () => {
  test('passes when the rewind menu opened', () => {
    const verdict = rewindVerdict([RUNNING, `${RUNNING}\n${REWIND_MENU}`]);

    expect(verdict.pass).toBe(true);
    expect(verdict.reason).toContain('opened the rewind menu');
    expect(describeVerdict(verdict)).toStartWith('PASS  three quick Esc presses');
  });

  test('fails when the rewind menu never opened', () => {
    const verdict = rewindVerdict([RUNNING, CANCELLED]);

    expect(verdict.pass).toBe(false);
    expect(verdict.reason).toContain('the rewind menu did not open');
    expect(describeVerdict(verdict)).toStartWith('FAIL  ');
  });

  test('fails when the turn never started', () => {
    const verdict = rewindVerdict(['nothing here', REWIND_MENU]);

    expect(verdict.pass).toBe(false);
    expect(verdict.reason).toBe('the turn never started, so nothing was tested');
  });
});
