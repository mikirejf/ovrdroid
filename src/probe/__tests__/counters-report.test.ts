import { describe, expect, test } from 'bun:test';

import type { Counted } from '../counter-file.ts';
import { countVerdict, formatCounters, medianWindow } from '../counters-report.ts';
import type { CounterWindow } from '../counters.ts';

function window(commit: number, over: Partial<CounterWindow> = {}): CounterWindow {
  return {
    commit,
    build: commit,
    frame: commit,
    frameMs: commit,
    root: commit,
    list: commit,
    md: commit,
    bytes: 100,
    spanMs: 2000,
    cpuMs: 50,
    ...over,
  };
}

function counted(...commits: number[]): Counted[] {
  return commits.map((commit) => ({ counters: { typing: window(commit) } }));
}

const NONE: Counted = { counters: undefined };

describe('medianWindow', () => {
  test('takes the median of every field', () => {
    const median = medianWindow([window(1), window(9, { bytes: 300 }), window(5)]);
    expect(median.commit).toBe(5);
    expect(median.bytes).toBe(100);
  });
});

describe('countVerdict', () => {
  test('names the binary that is lower when the interval clears zero', () => {
    const text = countVerdict(
      [
        ['/tmp/a', [40, 42, 41]],
        ['/tmp/b', [20, 21, 22]],
      ],
      'commits',
    );
    expect(text).toContain('paired commits (/tmp/b minus /tmp/a, n=3): mean -20.0');
    expect(text).toContain('/tmp/b is lower by 20.0');
  });

  test('says when the interval holds zero', () => {
    const text = countVerdict(
      [
        ['/tmp/a', [10, 20, 30]],
        ['/tmp/b', [12, 18, 31]],
      ],
      'commits',
    );
    expect(text).toContain('not resolved, the interval contains zero');
  });

  test('says one round is not a result', () => {
    const text = countVerdict(
      [
        ['/tmp/a', [40]],
        ['/tmp/b', [20]],
      ],
      'commits',
    );
    expect(text).toContain('one round is one sample, not a result');
  });

  test('refuses anything but two binaries', () => {
    expect(() => countVerdict([['/tmp/a', [1]]], 'commits')).toThrow('exactly two binaries');
  });
});

describe('formatCounters', () => {
  test('prints nothing when no binary wrote counters', () => {
    expect(formatCounters([['/tmp/a', [NONE, NONE]]])).toEqual([]);
  });

  test('prints one line per window for a binary with counters', () => {
    const lines = formatCounters([['/tmp/a', counted(4, 6, 8)]]);
    expect(lines).toContain('/tmp/a');
    expect(lines.find((line) => line.startsWith('  typing'))).toContain('6 commits');
  });

  test('skips the binary without counters and prints no verdicts', () => {
    const lines = formatCounters([
      ['/tmp/a', counted(4, 6)],
      ['/tmp/b', [NONE, NONE]],
    ]);
    expect(lines).toContain('/tmp/a');
    expect(lines).not.toContain('/tmp/b');
    expect(lines.some((line) => line.startsWith('paired'))).toBe(false);
  });

  test('two binaries with counters get a verdict for every metric in every window', () => {
    const lines = formatCounters([
      ['/tmp/a', counted(40, 42, 41)],
      ['/tmp/b', counted(20, 21, 22)],
    ]);
    const verdicts = lines.filter((line) => line.startsWith('paired'));
    expect(verdicts).toHaveLength(6);
    expect(verdicts[0]).toContain('paired typing commits');
    expect(verdicts[0]).toContain('/tmp/b is lower');
    expect(verdicts.some((line) => line.includes('ms building frames'))).toBe(true);
  });
});
