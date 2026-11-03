import { describe, expect, test } from 'bun:test';

import {
  historyPreviewVerdicts,
  hostLoggingSeen,
  reopenedHelpers,
} from '../history-preview-report.ts';

function entry(event: string, pid: number, sessionId: string): string {
  return `[2026-11-04T00:00:00.000Z] INFO: [Daemon] ${event} | Context: ${JSON.stringify({
    sessionId,
    'process.pid': pid,
  })}`;
}

describe('reopened helper history', () => {
  test('counts only completed helpers loaded by the tested process, once each', () => {
    const log = [
      entry('JSON-RPC handling load_session', 12, 'finished'),
      entry('JSON-RPC handling load_session', 12, 'finished'),
      entry('JSON-RPC handling load_session', 13, 'other'),
      entry('JSON-RPC handling load_session', 12, 'working'),
      entry('Session closed', 12, 'finished'),
    ].join('\n');
    expect(reopenedHelpers(log, 12, ['finished', 'other'])).toEqual(['finished']);
  });

  test('does not mistake an absent log for proof that no runtime reopened', () => {
    expect(hostLoggingSeen('', 12)).toBe(false);
    expect(hostLoggingSeen(entry('Hosting Droid agent in process', 13, 'main'), 12)).toBe(false);
    expect(hostLoggingSeen(entry('Hosting Droid agent in process', 12, 'main'), 12)).toBe(true);
    expect(
      historyPreviewVerdicts({
        completed: 10,
        previewShown: true,
        loggingSeen: false,
        reopened: [],
      }).every((verdict) => verdict.pass),
    ).toBe(false);
  });

  test('requires a real preview and fails when it reopened an agent', () => {
    const evidence = { completed: 10, previewShown: true, loggingSeen: true, reopened: [] };
    expect(historyPreviewVerdicts(evidence).every((verdict) => verdict.pass)).toBe(true);
    expect(
      historyPreviewVerdicts({ ...evidence, previewShown: false }).every((verdict) => verdict.pass),
    ).toBe(false);
    expect(
      historyPreviewVerdicts({ ...evidence, reopened: ['finished'] }).every(
        (verdict) => verdict.pass,
      ),
    ).toBe(false);
  });
});
