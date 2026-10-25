import { STUB_END } from './stub-model.ts';

export const REPLY_OPENING = 'A long answer about a small pipeline';
export const CANCELLED_TEXT = 'Request cancelled by user';
export const STOP_HINT = 'Press ESC to stop';

export const REWIND_MENU = 'Select a user message to rewind before';

export interface RewindVerdict {
  pass: boolean;
  reason: string;
}

export interface EscapeReading {
  started: boolean;
  hintShown: boolean;
  cancelled: boolean;
  completed: boolean;
}

export interface EscapeVerdict {
  pass: boolean;
  reason: string;
  hintShown: boolean;
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

function reasonFor(reading: EscapeReading): string | undefined {
  if (!reading.started) {
    return 'the turn never started, so nothing was tested';
  }
  if (reading.cancelled) {
    return `Esc stopped the turn: "${CANCELLED_TEXT}" showed`;
  }
  if (!reading.completed) {
    return 'the turn did not finish: the stub reply never reached its last line, though nothing said it was cancelled';
  }
  return undefined;
}

export function escapeVerdict(reading: EscapeReading): EscapeVerdict {
  const reason = reasonFor(reading);
  return {
    pass: reason === undefined,
    reason:
      reason ??
      'Esc left the turn running: the full reply showed and nothing said it was cancelled',
    hintShown: reading.hintShown,
  };
}

export function rewindVerdict(screens: readonly string[]): RewindVerdict {
  const shows = (needle: string) => screens.some((screen) => screen.includes(needle));
  if (!shows(REPLY_OPENING)) {
    return { pass: false, reason: 'the turn never started, so nothing was tested' };
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

export function describeRewind(verdict: RewindVerdict): string {
  return `${verdict.pass ? 'PASS' : 'FAIL'}  ${verdict.reason}`;
}

export function describeEscape(verdict: EscapeVerdict): string {
  return [
    `${verdict.pass ? 'PASS' : 'FAIL'}  ${verdict.reason}`,
    verdict.hintShown
      ? `"${STOP_HINT}" showed on screen while the turn ran`
      : `"${STOP_HINT}" never showed on screen`,
  ].join('\n');
}
