import type { RunRow } from '../task-ab-rows.ts';

export const OPUS = 'custom:droidproxy:opus-5-5';

export function row(overrides: Partial<RunRow> = {}): RunRow {
  return {
    rep: 1,
    task: 'chain',
    model: OPUS,
    arm: 'direct-on',
    seconds: 10,
    correct: true,
    reason: 'gave the code',
    error: null,
    sessionId: 's',
    usage: { input: 1, cacheRead: 2, cacheWrite: 3, output: 4 },
    costUsd: 0.5,
    requests: 2,
    nested: 3,
    directReadGrep: 1,
    scripts: 1,
    directOnlyRequests: 1,
    toolErrors: 0,
    ...overrides,
  };
}
