import { describe, expect, test } from 'bun:test';

import {
  ECHO_TIMEOUT_MS,
  markerAt,
  MARKERS,
  MISSED,
  pairedMedians,
  readEchoes,
  summariseEchoes,
} from '../busy-keys-read.ts';

describe('readEchoes', () => {
  test('times a marker from the write to the first chunk after it that shows the marker', () => {
    const chunks = [
      { atMs: 1005, text: 'streamed text' },
      { atMs: 1012, text: '\u001B[?2026h\u001B[3;5Hж\u001B[?2026l' },
      { atMs: 1030, text: 'ж again' },
    ];
    expect(readEchoes(chunks, [{ marker: 'ж', sentAt: 1000 }], ECHO_TIMEOUT_MS)).toEqual([12]);
  });

  test('finds a marker wrapped in escape sequences inside one chunk', () => {
    const chunks = [{ atMs: 507, text: '\u001B[1m\u001B[38;5;2m\u001B[2Kщ\u001B[0m\u001B[?25h' }];
    expect(readEchoes(chunks, [{ marker: 'щ', sentAt: 500 }], ECHO_TIMEOUT_MS)).toEqual([7]);
  });

  test('ignores a chunk from before the write, even one that shows the marker', () => {
    const chunks = [
      { atMs: 990, text: 'ж' },
      { atMs: 1020, text: 'ж' },
    ];
    expect(readEchoes(chunks, [{ marker: 'ж', sentAt: 1000 }], ECHO_TIMEOUT_MS)).toEqual([20]);
  });

  test('reports a marker that never shows as missed, not as a number', () => {
    const chunks = [
      { atMs: 1010, text: 'other output' },
      { atMs: 1020, text: 'more output' },
    ];
    expect(readEchoes(chunks, [{ marker: 'ж', sentAt: 1000 }], ECHO_TIMEOUT_MS)).toEqual([MISSED]);
  });

  test('reports an echo that arrives after the timeout as missed', () => {
    const chunks = [{ atMs: 1000 + ECHO_TIMEOUT_MS + 1, text: 'ж' }];
    expect(readEchoes(chunks, [{ marker: 'ж', sentAt: 1000 }], ECHO_TIMEOUT_MS)).toEqual([MISSED]);
  });

  test('reads each trial against its own marker', () => {
    const chunks = [
      { atMs: 1008, text: 'ж' },
      { atMs: 1140, text: 'щ' },
    ];
    const trials = [
      { marker: 'ж', sentAt: 1000 },
      { marker: 'щ', sentAt: 1130 },
    ];
    expect(readEchoes(chunks, trials, ECHO_TIMEOUT_MS)).toEqual([8, 10]);
  });
});

describe('markerAt', () => {
  test('gives neighbouring trials different markers and wraps around', () => {
    expect(markerAt(0)).not.toBe(markerAt(1));
    expect(markerAt(MARKERS.length)).toBe(markerAt(0));
  });
});

describe('summariseEchoes', () => {
  test('pools runs, leaves missed keys out of the quantiles and counts them', () => {
    const summary = summariseEchoes([
      [4, 6, MISSED],
      [8, 10],
    ]);
    expect(summary).toEqual({ echoed: 4, missed: 1, medianMs: 7, p95Ms: 9.7, maxMs: 10 });
  });

  test('has no numbers when every key was missed', () => {
    expect(summariseEchoes([[MISSED, MISSED]])).toEqual({ echoed: 0, missed: 2 });
  });
});

describe('pairedMedians', () => {
  test('keeps only the rounds in which both binaries echoed something', () => {
    const paired = pairedMedians([
      ['a', [[4, 6], [MISSED], [10]]],
      ['b', [[5], [7], [12, 14]]],
    ]);
    expect(paired).toEqual([
      ['a', [5, 10]],
      ['b', [5, 13]],
    ]);
  });
});
