import type { WaitReportsEvidence } from './scope-leak-coverage.ts';

export const COVERED_REPORTS: WaitReportsEvidence = {
  launched: 14,
  waitsStarted: 14,
  waitsFinished: 11,
  completed: 11,
  tornDown: 11,
  heldPending: 3,
  quickReplies: 11,
  closedHosts: 11,
  mainState: 'executing_tool',
  observedAfterTeardownMs: 30_000,
};
