import { describe, expect, test } from 'bun:test';

import { parseTrace } from '../trace.ts';

const TAB = String.fromCodePoint(9);

function row(parts: [string, string, string, string, string]): string {
  return parts.join(TAB);
}

describe('parseTrace', () => {
  test('sorts rows by start time', () => {
    const rows = parseTrace(
      [row(['1', 'b', 'joined', '20.0', '30.0']), row(['1', 'a', 'joined', '5.0', '9.0']), ''].join(
        '\n',
      ),
    );
    expect(rows.map((entry) => entry.phase)).toEqual(['a', 'b']);
  });

  test('passes the join kind through and defaults an empty one to joined', () => {
    const rows = parseTrace(
      [
        row(['1', 'a', '', '1.0', '2.0']),
        row(['1', 'b', 'detached', '3.0', '4.0']),
        row(['1', 'c', 'boundary', '5.0', '5.0']),
      ].join('\n'),
    );
    expect(rows.map((entry) => entry.kind)).toEqual(['joined', 'detached', 'boundary']);
  });

  test('keeps only the process that painted', () => {
    const rows = parseTrace(
      [
        row(['9', 'boot', 'joined', '0.0', '70.0']),
        row(['7', 'boot', 'joined', '0.0', '80.0']),
        row(['9', 'ready', 'boundary', '300.0', '300.0']),
        row(['7', 'first_paint', 'boundary', '600.0', '600.0']),
      ].join('\n'),
    );
    expect(rows.map((entry) => entry.phase)).toEqual(['boot', 'first_paint']);
  });

  test('skips malformed lines', () => {
    const rows = parseTrace(
      [
        'garbage',
        row(['1', 'a', 'joined', 'x', '2.0']),
        row(['1', 'b', 'joined', '1.0', '2.0']),
      ].join('\n'),
    );
    expect(rows).toHaveLength(1);
  });

  test('keeps the numeric start and end', () => {
    const [first] = parseTrace(row(['1', 'a', 'joined', '12.5', '99.25']));
    expect(first?.startMs).toBe(12.5);
    expect(first?.endMs).toBe(99.25);
  });
});
