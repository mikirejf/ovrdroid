import { describe, expect, test } from 'bun:test';

import { bustsByTurn } from '../effort-switch-verdict.ts';
import type { BustLine } from '../logs.ts';

const MODEL = 'custom:droidproxy:sonnet-5-5';

function bustLine(at: string): BustLine {
  return {
    kind: 'bust',
    at,
    sessionId: 's',
    modelId: MODEL,
    previousModelId: MODEL,
    providerPath: 'anthropic',
    reason: 'not-append-only',
    firstMismatchIndex: 4,
    previousSegmentLabel: 'a',
    currentSegmentLabel: 'b',
    mismatchRegion: 'system',
    mismatchKind: 'content-changed',
  };
}

describe('bustsByTurn files a warning under the first turn that ended after it', () => {
  const ends = {
    seed: '2026-10-15T10:00:10.000Z',
    control: '2026-10-15T10:00:20.000Z',
    switched: '2026-10-15T10:00:30.000Z',
  };

  test('a warning between two turn ends belongs to the later turn', () => {
    const found = bustsByTurn([bustLine('2026-10-15T10:00:25.000Z')], ends);
    expect(found).toEqual([
      { turn: 'switched', region: 'system', kind: 'content-changed', index: 4 },
    ]);
  });

  test('a warning before the seed ends belongs to the seed', () => {
    expect(bustsByTurn([bustLine('2026-10-15T10:00:05.000Z')], ends)[0]?.turn).toBe('seed');
  });

  test('a warning after the last turn is dropped', () => {
    expect(bustsByTurn([bustLine('2026-10-15T10:01:00.000Z')], ends)).toEqual([]);
  });
});
