import { STUB_END } from './stub-model.ts';

export const REPLY_OPENING = 'A long answer about a small pipeline';
export const CANCELLED_TEXT = 'Request cancelled by user';
export const STOCK_STOP_HINT = '(Press ESC to stop)';
export const STOP_HINT = '(Esc twice to stop)';
export const STOP_HINTS = [STOCK_STOP_HINT, STOP_HINT] as const;

export const REWIND_MENU = 'Select a user message to rewind before';

export interface Verdict {
  pass: boolean;
  reason: string;
}

export interface EscapeReading {
  started: boolean;
  hintShown: boolean;
  cancelled: boolean;
  completed: boolean;
}

export function readEscape(screens: readonly string[]): EscapeReading {
  const shows = (needle: string) => screens.some((screen) => screen.includes(needle));
  return {
    started: shows(REPLY_OPENING),
    hintShown: shows(STOP_HINT),
    cancelled: shows(CANCELLED_TEXT),
    completed: shows(STUB_END),
  };
}

const NOT_STARTED = 'the turn never started, so nothing was tested';

export function singleEscapeVerdict(reading: EscapeReading): Verdict {
  if (!reading.started) {
    return { pass: false, reason: NOT_STARTED };
  }
  if (reading.cancelled) {
    return { pass: false, reason: `one Esc stopped the turn: "${CANCELLED_TEXT}" showed` };
  }
  if (!reading.completed) {
    return {
      pass: false,
      reason:
        'the turn did not finish: the stub reply never reached its last line, though nothing said it was cancelled',
    };
  }
  return {
    pass: true,
    reason:
      'one Esc left the turn running: the full reply showed and nothing said it was cancelled',
  };
}

export function doubleEscapeVerdict(reading: EscapeReading): Verdict {
  if (!reading.started) {
    return { pass: false, reason: NOT_STARTED };
  }
  if (reading.cancelled) {
    return {
      pass: true,
      reason: `two quick Esc presses stopped the turn: "${CANCELLED_TEXT}" showed`,
    };
  }
  return {
    pass: false,
    reason: reading.completed
      ? 'two quick Esc presses did not stop the turn: the full reply showed and nothing said it was cancelled'
      : `two quick Esc presses did not stop the turn: "${CANCELLED_TEXT}" never showed, and the reply did not finish either`,
  };
}

export function hintVerdict(reading: EscapeReading): Verdict {
  return reading.hintShown
    ? { pass: true, reason: `"${STOP_HINT}" showed on screen while the turn ran` }
    : { pass: false, reason: `"${STOP_HINT}" never showed on screen` };
}

export function rewindVerdict(screens: readonly string[]): Verdict {
  const shows = (needle: string) => screens.some((screen) => screen.includes(needle));
  if (!shows(REPLY_OPENING)) {
    return { pass: false, reason: NOT_STARTED };
  }
  if (!shows(REWIND_MENU)) {
    return {
      pass: false,
      reason: `the rewind menu did not open: "${REWIND_MENU}" never showed after three quick Esc presses`,
    };
  }
  return {
    pass: true,
    reason: 'three quick Esc presses stopped the turn and opened the rewind menu',
  };
}

export function describeVerdict(verdict: Verdict): string {
  return `${verdict.pass ? 'PASS' : 'FAIL'}  ${verdict.reason}`;
}
