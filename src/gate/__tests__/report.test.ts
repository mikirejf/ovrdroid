import { describe, expect, test } from 'bun:test';

import type { CheckResult } from '../report.ts';
import { describeResult, summarise } from '../report.ts';

function result(name: string, passed: boolean, seconds = 2): CheckResult {
  return { name, passed, seconds, log: `/logs/${name}.log` };
}

describe('describeResult', () => {
  test('prints a pass without its log', () => {
    expect(describeResult(result('highlight', true, 12.4))).toBe('pass  highlight  12s');
  });

  test('prints a failure with the path to its log', () => {
    expect(describeResult(result('clear', false, 3))).toBe('FAIL  clear  3s  /logs/clear.log');
  });
});

describe('summarise', () => {
  test('passes only when every check passed', () => {
    const summary = summarise([result('a', true), result('b', true)], 4);
    expect(summary.passed).toBe(true);
    expect(summary.lines).toEqual(['2 of 2 checks passed in 4s']);
  });

  test('reports the wall time, which is shorter than the checks added up when they overlap', () => {
    const summary = summarise([result('a', true, 30), result('b', true, 30)], 31);
    expect(summary.lines).toEqual(['2 of 2 checks passed in 31s']);
  });

  test('fails on one failure and names each failed check with its log', () => {
    const summary = summarise([result('a', true), result('b', false), result('c', false)], 6);
    expect(summary.passed).toBe(false);
    expect(summary.lines).toEqual([
      '1 of 3 checks passed in 6s',
      'failed: b  /logs/b.log',
      'failed: c  /logs/c.log',
    ]);
  });

  test('never passes with no checks run', () => {
    expect(summarise([], 0).passed).toBe(false);
  });
});
