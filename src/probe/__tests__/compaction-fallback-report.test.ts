import { describe, expect, test } from 'bun:test';

import type { Evidence } from '../compaction-fallback-report.ts';
import {
  CANNED_REFUSAL,
  compactRowsFor,
  fallbackVerdict,
  requestKind,
} from '../compaction-fallback-report.ts';
import { reuseBody, stockCaptured, SUMMARY } from './compaction-replay-harness.ts';

const SESSION = 'session-1';
const STORED_SUMMARY = SUMMARY.replace('<summary>\n', '').replace('\n</summary>', '');

function row(path: string, sessionId = SESSION, head?: string): string {
  return JSON.stringify({ t: 1, s: sessionId, m: 'claude-haiku-5-5', compact: path, head });
}

function passing(): Evidence {
  return {
    kinds: ['ordinary', 'reuse', 'stock'],
    rows: compactRowsFor(row('not-summary', SESSION, CANNED_REFUSAL.slice(0, 40)), SESSION),
    stored: [STORED_SUMMARY],
    reply: CANNED_REFUSAL,
    timedOut: false,
  };
}

describe('requestKind sorts what Droid sends to the relay', () => {
  test('tells reuse, stock and ordinary requests apart', () => {
    expect(requestKind(reuseBody())).toBe('reuse');
    expect(requestKind(stockCaptured())).toBe('stock');
    expect(requestKind({ messages: [{ role: 'user', content: 'hi' }] })).toBe('ordinary');
  });

  test('treats a body that is not a JSON object as ordinary', () => {
    expect(requestKind(null)).toBe('ordinary');
    expect(requestKind([1, 2])).toBe('ordinary');
    expect(requestKind('text')).toBe('ordinary');
  });
});

describe('compactRowsFor reads the log rows of one session', () => {
  test('keeps this session and skips others, blank lines and rows without a compact field', () => {
    const log = [
      row('reuse', 'other'),
      '',
      row('not-summary'),
      JSON.stringify({ t: 2, s: SESSION, m: 'claude-haiku-5-5' }),
      'not json',
    ].join('\n');
    expect(compactRowsFor(log, SESSION).map((found) => found.path)).toEqual(['not-summary']);
  });
});

describe('fallbackVerdict', () => {
  test('passes when the refusal is rejected, stock runs, and a real summary is stored', () => {
    const verdict = fallbackVerdict(passing());
    expect(verdict.pass).toBe(true);
    expect(verdict.finding).toBe(
      `the patched Droid rejected the refusal (not-summary), logged how it began, fell back to stock, and stored a ${STORED_SUMMARY.length}-character summary with 3 stock sections`,
    );
  });

  test('passes but says so when the stored text is not the refusal and has no stock layout', () => {
    const verdict = fallbackVerdict({ ...passing(), stored: ['The work so far, in prose.'] });
    expect(verdict.pass).toBe(true);
    expect(verdict.finding).toContain('not the refusal but has only 0 of the stock summary');
  });

  test('fails when Droid never sent the reuse request', () => {
    const verdict = fallbackVerdict({ ...passing(), kinds: ['ordinary', 'stock'] });
    expect(verdict.pass).toBe(false);
    expect(verdict.finding).toContain('never sent the reuse compaction request');
  });

  test('fails when no stock request follows the reuse request', () => {
    const verdict = fallbackVerdict({ ...passing(), kinds: ['ordinary', 'reuse'], stored: [] });
    expect(verdict.pass).toBe(false);
    expect(verdict.finding).toContain('no stock request followed');
  });

  test('fails when a stock request came before the reuse request only', () => {
    const verdict = fallbackVerdict({ ...passing(), kinds: ['stock', 'reuse'] });
    expect(verdict.pass).toBe(false);
    expect(verdict.finding).toContain('no stock request followed');
  });

  test('fails when the refusal is stored as the summary', () => {
    const verdict = fallbackVerdict({
      ...passing(),
      kinds: ['ordinary', 'reuse'],
      stored: [`<summary>\n${CANNED_REFUSAL}\n</summary>`],
    });
    expect(verdict.pass).toBe(false);
    expect(verdict.finding).toContain('accepted the refusal');
  });

  test('fails when the log has no not-summary row, and names the rows it has', () => {
    const verdict = fallbackVerdict({
      ...passing(),
      rows: compactRowsFor([row('error'), row('empty')].join('\n'), SESSION),
    });
    expect(verdict.pass).toBe(false);
    expect(verdict.finding).toContain('no not-summary row');
    expect(verdict.finding).toContain('error, empty');
  });

  test('fails when the not-summary row does not hold how the refused reply began', () => {
    const verdict = fallbackVerdict({
      ...passing(),
      rows: compactRowsFor(row('not-summary'), SESSION),
    });
    expect(verdict.pass).toBe(false);
    expect(verdict.finding).toContain('does not hold how the refused reply began');
  });

  test('fails when no summary is stored before the wait runs out', () => {
    const verdict = fallbackVerdict({ ...passing(), stored: [], timedOut: true });
    expect(verdict.pass).toBe(false);
    expect(verdict.finding).toContain('no summary was stored (the wait ran out)');
  });

  test('a custom reply is matched on its first line', () => {
    const verdict = fallbackVerdict({
      ...passing(),
      kinds: ['ordinary', 'reuse'],
      reply: '\nNo thanks.\nMore words.',
      stored: ['<summary>\nNo   thanks.\n</summary>'],
    });
    expect(verdict.finding).toContain('accepted the refusal');
  });
});
