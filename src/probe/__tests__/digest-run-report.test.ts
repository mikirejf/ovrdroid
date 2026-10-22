import { describe, expect, test } from 'bun:test';

import {
  ADAPTIVE_STORED,
  STORED_REFUSAL,
  STORED_REFUSAL_WITH_HEADINGS,
} from '../../patch/__tests__/summary-fixtures.ts';
import type { DigestKey } from '../digest-key.ts';
import {
  describeBinary,
  describeRun,
  digestFindings,
  runResult,
  summariseBinary,
} from '../digest-run-report.ts';
import type { RunEvidence, RunResult } from '../digest-run-report.ts';

const KEY: DigestKey = {
  compacted: 42,
  mostToolCalls: { run: 21, title: 'Grunt: Browser-test', value: 300 },
  notFound: [{ run: 71, title: 'Grunt: Map specs' }],
  browserTitles: [7, 21].map((run) => ({ run, title: `Grunt: Title ${run}` })),
  mostOutTokens: { run: 21, value: 181_019 },
  briefs: [
    { run: 82, sentence: 'Repo: a.' },
    { run: 83, sentence: 'Repo: b.' },
    { run: 84, sentence: 'Read-only lookup.' },
  ],
};

const RIGHT = `1. 42 of 84.
2. Run 21, 300.
3. Run 71.
4. Runs 7 and 21.
5. Run 21, 181019.
6. Run 82: "Repo: a." Run 83: "Repo: b." Run 84: "Read-only lookup."`;

const WRONG = RIGHT.replace('1. 42 of 84.', '1. 41 of 84.');

const SUMMARY_TEXT = [
  '1. Chronological Play-by-Play',
  '2. Primary Request and Intent',
  '3. Pending Tasks',
].join('\n');

const REFUSAL_TEXT = "I won't write that summary.";

function message(role: string, content: object[]): string {
  return JSON.stringify({ type: 'message', message: { role, content } });
}

function parentTranscript(): string {
  return [
    JSON.stringify({ type: 'session_start', id: 'parent' }),
    message('assistant', [{ type: 'tool_use' }]),
    message('user', [{ type: 'tool_result' }]),
    message('assistant', [{ type: 'text', text: 'relayed' }]),
  ].join('\n');
}

function gruntTranscript(reply: string, stored: readonly string[]): string {
  return [
    JSON.stringify({ type: 'session_start', id: 'grunt', callingSessionId: 'parent' }),
    ...stored.map((summaryText, at) =>
      JSON.stringify({
        type: 'compaction_state',
        timestamp: `2026-10-15T11:1${at}:00.000Z`,
        summaryKind: 'llm_summary',
        summaryText,
      }),
    ),
    message('assistant', [{ type: 'text', text: reply }]),
  ].join('\n');
}

function usageRow(sessionId: string, compact: string): string {
  return JSON.stringify({ t: 1, s: sessionId, m: 'claude-haiku-5-5', compact });
}

function evidence(overrides: Partial<RunEvidence> = {}): RunEvidence {
  return {
    binary: 'droid-a',
    run: 1,
    parent: { id: 'parent', text: parentTranscript() },
    transcripts: [
      { id: 'parent', text: parentTranscript() },
      { id: 'grunt', text: gruntTranscript(RIGHT, [SUMMARY_TEXT, REFUSAL_TEXT]) },
    ],
    log: [
      usageRow('grunt', 'reuse'),
      usageRow('other', 'reuse'),
      usageRow('grunt', 'not-summary'),
    ].join('\n'),
    key: KEY,
    timedOut: false,
    seconds: 100,
    ...overrides,
  };
}

describe('runResult reads one finished session from its files', () => {
  test('scores the grunt reply and lists the compactions of the grunt only', () => {
    const scored = runResult(evidence());
    expect(scored.total).toBe(6);
    expect(scored.scores).toEqual([1, 1, 1, 1, 1, 1]);
    expect(scored.gruntId).toBe('grunt');
    expect(scored.compactions).toBe(2);
    expect(scored.paths).toEqual(['reuse', 'not-summary']);
    expect(scored.summaries).toEqual([
      { chars: SUMMARY_TEXT.length, isSummary: true },
      { chars: REFUSAL_TEXT.length, isSummary: false },
    ]);
  });

  test('counts adaptive summaries as summaries and a long refusal as a non-summary', () => {
    const scored = runResult(
      evidence({
        transcripts: [
          { id: 'parent', text: parentTranscript() },
          {
            id: 'grunt',
            text: gruntTranscript(RIGHT, [
              ADAPTIVE_STORED,
              STORED_REFUSAL,
              STORED_REFUSAL_WITH_HEADINGS,
            ]),
          },
        ],
      }),
    );
    expect(scored.summaries.map((stored) => stored.isSummary)).toEqual([true, false, false]);
  });

  test('gives a wrong answer a lower score', () => {
    const wrong = runResult(
      evidence({
        transcripts: [
          { id: 'parent', text: parentTranscript() },
          { id: 'grunt', text: gruntTranscript(WRONG, []) },
        ],
      }),
    );
    expect(wrong.total).toBe(5);
    expect(wrong.scores[0]).toBe(0);
    expect(wrong.compactions).toBe(0);
  });

  test('gives no score to a session that timed out, and keeps its compactions', () => {
    const timedOut = runResult(evidence({ timedOut: true }));
    expect(timedOut.total).toBeUndefined();
    expect(timedOut.scores).toEqual([]);
    expect(timedOut.timedOut).toBe(true);
    expect(timedOut.compactions).toBe(2);
  });

  test('accepts a timeout before the grunt started', () => {
    const early = runResult(
      evidence({ timedOut: true, transcripts: [{ id: 'parent', text: parentTranscript() }] }),
    );
    expect(early.gruntId).toBe('');
    expect(early.paths).toEqual([]);
  });

  test('fails loudly when the parent replied but no grunt names it', () => {
    expect(() =>
      runResult(evidence({ transcripts: [{ id: 'parent', text: parentTranscript() }] })),
    ).toThrow('no transcript names session parent as its caller');
  });
});

function aRun(run: number, overrides: Partial<RunResult> = {}): RunResult {
  return {
    binary: 'droid-a',
    run,
    parentId: 'p',
    gruntId: 'g',
    scores: [],
    total: 6,
    compactions: 1,
    paths: ['reuse'],
    summaries: [{ chars: 900, isSummary: true }],
    timedOut: false,
    seconds: 60,
    ...overrides,
  };
}

describe('summariseBinary and describeBinary', () => {
  const results = [
    aRun(1, { total: 6, paths: ['reuse', 'reuse'], compactions: 2 }),
    aRun(2, { total: 3, paths: ['not-summary'], summaries: [{ chars: 5, isSummary: false }] }),
    aRun(3, { total: undefined, timedOut: true, compactions: 0, paths: [], summaries: [] }),
    aRun(4, { total: 4.5, compactions: 0, paths: [], summaries: [] }),
  ];

  test('counts scores, paths, non-summaries and timeouts', () => {
    const summary = summariseBinary('droid-a', results);
    expect(summary.runs).toBe(4);
    expect(summary.scored).toBe(3);
    expect(summary.mean).toBe(4.5);
    expect(summary.min).toBe(3);
    expect(summary.max).toBe(6);
    expect(summary.compactions).toBe(3);
    expect([...summary.paths]).toEqual([
      ['reuse', 2],
      ['not-summary', 1],
    ]);
    expect(summary.nonSummaries).toBe(1);
    expect(summary.timeouts).toBe(1);
    expect(summary.uncompacted).toEqual([3, 4]);
  });

  test('prints the table with the zero-compaction runs called out', () => {
    expect(describeBinary(summariseBinary('droid-a', results))).toEqual([
      'droid-a',
      '  runs: 4, scored: 3',
      '  score: mean 4.50 of 6 (min 3.00, max 6.00)',
      '  compactions: 3',
      '  compact paths: reuse 2, not-summary 1',
      '  stored non-summaries: 1',
      '  timeouts: 1',
      '  run 3 compacted zero times, so it tests nothing about compaction',
      '  run 4 compacted zero times, so it tests nothing about compaction',
    ]);
  });

  test('says none scored when every run timed out', () => {
    const lines = describeBinary(
      summariseBinary('droid-a', [aRun(1, { total: undefined, timedOut: true })]),
    );
    expect(lines).toContain('  score: none scored');
  });

  test('describeRun gives one line per session', () => {
    expect(describeRun(aRun(2, { scores: [1, 0.5], total: 1.5 }))).toBe(
      'droid-a run 2: 1.50 of 6 (1.00 0.50); 1 stored (0 not summaries), paths: reuse; 60s',
    );
  });
});

function findings(results: RunResult[]): string[] {
  return digestFindings(summariseBinary('droid-a', results));
}

describe('digestFindings', () => {
  test('a healthy run, every session compacted and one on the reuse path, has no findings', () => {
    expect(findings([aRun(1), aRun(2, { paths: ['reuse-extended'] }), aRun(3)])).toEqual([]);
  });

  test('a fallback beside a reuse compaction is still healthy', () => {
    expect(
      findings([aRun(1, { paths: ['reuse', 'not-summary'], compactions: 2 }), aRun(2)]),
    ).toEqual([]);
  });

  test('a timed-out session is a finding', () => {
    expect(findings([aRun(1), aRun(2, { timedOut: true, total: undefined })])).toEqual([
      'droid-a: 1 of 2 sessions timed out',
    ]);
  });

  test('a session that never compacted is a finding', () => {
    expect(findings([aRun(1), aRun(2, { compactions: 0, paths: [], summaries: [] })])).toEqual([
      'droid-a: runs 2 compacted zero times, so they did not exercise compaction',
    ]);
  });

  test('compactions that all fell back to stock never exercised the reuse patch', () => {
    const [finding, ...rest] = findings([
      aRun(1, { paths: ['prefix-mismatch'] }),
      aRun(2, { paths: ['other-model', 'not-summary'], compactions: 2 }),
    ]);
    expect(rest).toEqual([]);
    expect(finding).toContain('no compaction took the reuse path');
    expect(finding).toContain('not-summary 1, other-model 1, prefix-mismatch 1');
  });

  test('a stored compaction with no log row is not the reuse path', () => {
    expect(findings([aRun(1, { paths: [] })])[0]).toContain('paths logged: none logged');
  });

  test('a binary with no finished session fails the reuse rule', () => {
    expect(findings([])).toHaveLength(1);
  });

  test('every broken rule is listed', () => {
    expect(
      findings([
        aRun(1, { timedOut: true, total: undefined, compactions: 0, paths: [], summaries: [] }),
      ]),
    ).toHaveLength(3);
  });
});
