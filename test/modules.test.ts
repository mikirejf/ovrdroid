import { describe, expect, test } from 'bun:test';

import { formatModules, parseModules } from '../src/modules.ts';

const TAB = String.fromCodePoint(9);

function row(selfMs: string, body: string): string {
  return `${selfMs}${TAB}${body}`;
}

describe('parseModules', () => {
  test('sorts the most expensive labelled module first', () => {
    const report = parseModules([row('1.50', 'cheap'), row('12.25', 'costly'), ''].join('\n'));
    expect(report.rows.map((entry) => entry.body)).toEqual(['costly', 'cheap']);
  });

  test('keeps a body that contains tabs intact', () => {
    const [first] = parseModules(row('3.00', `a${TAB}b`)).rows;
    expect(first?.body).toBe(`a${TAB}b`);
  });

  test('skips lines without a numeric cost', () => {
    const report = parseModules(['garbage', row('x', 'body'), row('1.0', 'kept')].join('\n'));
    expect(report.moduleCount).toBe(1);
    expect(report.rows).toHaveLength(1);
  });

  test('totals every entry, labelled or not', () => {
    const report = parseModules(
      [row('1.5', 'a'), row('2.25', 'b'), row('0.1', ''), row('0.15', '')].join('\n'),
    );
    expect(report.totalMs).toBeCloseTo(4);
    expect(report.moduleCount).toBe(4);
  });

  test('aggregates the unlabelled entries separately', () => {
    const report = parseModules(
      [row('1.5', 'a'), row('0.1', ''), row('0.15', ''), row('0.05', '')].join('\n'),
    );
    expect(report.unlabelledCount).toBe(3);
    expect(report.unlabelledMs).toBeCloseTo(0.3);
    expect(report.rows).toHaveLength(1);
  });

  test('keeps sub-threshold entries that the payload no longer drops', () => {
    const report = parseModules([row('0.19', ''), row('0.19', '')].join('\n'));
    expect(report.moduleCount).toBe(2);
    expect(report.totalMs).toBeCloseTo(0.38);
  });
});

describe('formatModules', () => {
  test('truncates the body to the requested width', () => {
    expect(formatModules(parseModules(row('1.0', 'abcdef')).rows, 3)).toEndWith('abc');
  });
});
