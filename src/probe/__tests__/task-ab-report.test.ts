import { describe, expect, test } from 'bun:test';

import { describeRun, describeTotals, reportLines, totalsOf } from '../task-ab-report.ts';
import { row } from './task-ab-rows-harness.ts';

describe('totalsOf and describeTotals', () => {
  const rows = [
    row(),
    row({ rep: 2, requests: 3, seconds: 20, costUsd: 0.25, toolErrors: 1 }),
    row({ rep: 3, correct: false, requests: 7 }),
  ];

  test('sums the counts and keeps per-run lists for the medians', () => {
    const totals = totalsOf(rows);
    expect(totals.correct).toBe(2);
    expect(totals.requests).toEqual([2, 3, 7]);
    expect(totals.costUsd).toBeCloseTo(1.25);
    expect(totals.counts.nested).toBe(9);
    expect(totals.counts.toolErrors).toBe(1);
  });

  test('says it in words', () => {
    expect(describeTotals('opus-5-5, direct-on', totalsOf(rows))).toBe(
      'opus-5-5, direct-on: 2/3 correct, 12 requests (median 3 per run), $1.2500 in total, median 10s per run; 3 direct Read/Grep calls, 3 Script calls, 9 calls made inside Scripts, 1 failed tool call, 3 requests that made only direct Read/Grep/TodoWrite calls',
    );
  });

  test('keeps a run without a result out of the medians but counts it wrong', () => {
    const lines = describeTotals(
      'x',
      totalsOf([row(), row({ error: 'timed out', correct: false })]),
    );
    expect(lines).toContain('1/2 correct');
    expect(lines).toContain('2 requests (median 2 per run)');
    expect(lines).toContain('1 run without a result, counted as wrong');
  });

  test('says the dollars cover the finished runs only when a run has no result', () => {
    const errored = row({ error: 'timed out', correct: false, costUsd: 0 });
    const lines = describeTotals('x', totalsOf([row(), row({ costUsd: 0.25 }), errored]));
    expect(lines).toContain('$0.7500 over the 2 finished runs, median');
    expect(lines).not.toContain('in total');
    expect(describeTotals('x', totalsOf([row(), errored]))).toContain(
      '$0.5000 over the 1 finished run, median',
    );
  });
});

describe('describeRun', () => {
  test('gives one line per run for each outcome', () => {
    expect(describeRun(row())).toBe(
      'rep 1 chain, opus-5-5, direct-on: correct; 2 requests, 10s, $0.5000',
    );
    expect(describeRun(row({ correct: false, reason: 'wrong code' }))).toContain(
      'WRONG (wrong code)',
    );
    expect(describeRun(row({ error: 'timed out' }))).toBe(
      'rep 1 chain, opus-5-5, direct-on: no result: timed out',
    );
  });
});

describe('reportLines', () => {
  const rows = [
    row(),
    row({ arm: 'direct-off', requests: 5 }),
    row({ task: 'fix', correct: false, reason: 'tests fail' }),
  ];
  const lines = reportLines(rows);

  test('summarises per model and binary, then per task', () => {
    expect(lines[0]).toBe('3 runs, per model and binary:');
    expect(lines.filter((line) => line.startsWith('  opus-5-5, direct-'))).toHaveLength(2);
    expect(lines).toContain('per task:');
    expect(lines.some((line) => line.startsWith('  fix, opus-5-5, direct-on: 0/1 correct'))).toBe(
      true,
    );
  });

  test('says the per-task dollars cover the finished runs only when a run has no result', () => {
    const mixed = reportLines([
      row(),
      row({ rep: 2, error: 'timed out', correct: false, costUsd: 0 }),
    ]);
    expect(mixed).toContain(
      '  chain, opus-5-5, direct-on: 1/2 correct, median 2 requests, median 10s, $0.5000 over the 1 finished run',
    );
  });

  test('lists the wrong runs with their reason and ends on how cost is figured', () => {
    expect(lines).toContain('  rep 1 fix, opus-5-5, direct-on: wrong: tests fail');
    expect(lines.at(-1)).toContain('1 hour write');
  });

  test('says price unknown for a model without a cost and still totals the priced one', () => {
    const free = 'custom:openrouter:inkling-free';
    const mixed = reportLines([
      row(),
      row({ rep: 2, costUsd: 0.25 }),
      row({ model: free, costUsd: null }),
      row({ model: free, rep: 2, costUsd: null }),
    ]);
    expect(
      mixed.some(
        (line) => line.startsWith('  opus-5-5, direct-on:') && line.includes('$0.7500 in total'),
      ),
    ).toBe(true);
    const unpriced = mixed.filter((line) => line.includes('custom:openrouter:inkling-free'));
    expect(unpriced.length).toBeGreaterThan(0);
    for (const line of unpriced) {
      expect(line).toContain('price unknown');
      expect(line).not.toContain('$');
    }
    expect(describeRun(row({ model: free, costUsd: null }))).toContain('price unknown');
  });

  test('says so when every run was right, and when there are no runs', () => {
    expect(reportLines([row()])).toContain('every run answered correctly');
    expect(reportLines([])).toEqual(['no runs to report']);
  });
});
