import { describe, expect, test } from 'bun:test';

import {
  ADAPTIVE_STORED,
  STORED_REFUSAL_WITH_HEADINGS,
} from '../../patch/__tests__/summary-fixtures.ts';
import { PARENT_BRIEF_LEAD } from '../../patch/summary-format.ts';
import type { CompactionRecord, CompactRow } from '../summaries-report.ts';
import {
  compactionsOf,
  JOIN_WINDOW_MS,
  NO_LOG_LINE,
  parseCompactRow,
  PREVIEW_CHARS,
  summariesReport,
  UNKNOWN_MODEL,
} from '../summaries-report.ts';

const SUMMARY = [
  '## 1. Chronological Play-by-Play',
  'The user asked for a fix.',
  '## 2. Approach',
  'Read the parser.',
  '## 3. Next Steps',
  'Run the tests.',
].join('\n');

const REFUSAL = "I won't write that summary.\n  I'm still in the middle of the exploration.";

const NOON = Date.parse('2026-10-11T12:00:00.000Z');
const NOON_ISO = '2026-10-11T12:00:00.000Z';
const SECOND = 1000;

function compaction(overrides: Partial<CompactionRecord> = {}): CompactionRecord {
  return {
    sessionId: 'sess-a',
    subagent: false,
    timestamp: NOON_ISO,
    text: SUMMARY,
    ...overrides,
  };
}

function row(overrides: Partial<CompactRow> = {}): CompactRow {
  return { at: NOON, sessionId: 'sess-a', model: 'model-x', path: 'reuse', head: '', ...overrides };
}

function stored(fields: { summaryKind?: string; timestamp?: string } = {}): string {
  return JSON.stringify({
    type: 'compaction_state',
    summaryKind: 'llm_summary',
    timestamp: NOON_ISO,
    summaryText: SUMMARY,
    ...fields,
  });
}

const MAIN_HEADER = JSON.stringify({ type: 'session_start', id: 'sess-a' });
const SUBAGENT_HEADER = JSON.stringify({
  type: 'session_start',
  id: 'sess-a',
  callingSessionId: 'sess-parent',
});

describe('parseCompactRow reads compaction rows only', () => {
  test('a compact row keeps time, session, model and path', () => {
    const line = '{"t":1792060989138,"s":"abc","m":"custom:x:haiku","compact":"reuse"}';
    expect(parseCompactRow(line)).toEqual({
      at: 1_792_060_989_138,
      sessionId: 'abc',
      model: 'custom:x:haiku',
      path: 'reuse',
      head: '',
    });
  });

  test('a not-summary row keeps how the rejected reply began', () => {
    const line =
      '{"t":1,"s":"abc","m":"custom:x:haiku","compact":"not-summary","head":"I will keep working."}';
    expect(parseCompactRow(line)?.head).toBe('I will keep working.');
  });

  test('a per-request usage row is skipped', () => {
    const line = '{"t":1,"s":"abc","m":"m","in":2,"cr":3,"cw":4,"out":5,"th":0}';
    expect(parseCompactRow(line)).toBeUndefined();
  });

  test('junk, blank lines and rows with the wrong types are skipped', () => {
    expect(parseCompactRow('')).toBeUndefined();
    expect(parseCompactRow('"compact" but not json')).toBeUndefined();
    expect(parseCompactRow('{"t":"1","s":"a","m":"m","compact":"reuse"}')).toBeUndefined();
    expect(parseCompactRow('{"t":1,"s":"a","m":"m","compact":7}')).toBeUndefined();
  });
});

describe('compactionsOf reads stored summaries from a session file', () => {
  test('a main session yields a main record with the summary text', () => {
    const text = [MAIN_HEADER, '{"type":"message"}', stored()].join('\n');
    expect(compactionsOf('sess-a', text)).toEqual([
      { sessionId: 'sess-a', subagent: false, timestamp: NOON_ISO, text: SUMMARY },
    ]);
  });

  test('a header with callingSessionId marks a subagent', () => {
    const text = [SUBAGENT_HEADER, stored()].join('\n');
    expect(compactionsOf('sess-a', text).map((record) => record.subagent)).toEqual([true]);
  });

  test('only llm_summary compactions count', () => {
    const text = [MAIN_HEADER, stored({ summaryKind: 'other' })].join('\n');
    expect(compactionsOf('sess-a', text)).toEqual([]);
  });

  test('--since drops earlier compactions and keeps the one at the boundary', () => {
    const text = [
      MAIN_HEADER,
      stored({ timestamp: '2026-10-11T11:59:59.999Z' }),
      stored({ timestamp: NOON_ISO }),
    ].join('\n');
    expect(compactionsOf('sess-a', text, NOON).map((record) => record.timestamp)).toEqual([
      NOON_ISO,
    ]);
  });

  test('a file without compactions, or with a damaged line, yields nothing', () => {
    expect(compactionsOf('sess-a', `${MAIN_HEADER}\n{"type":"message"}`)).toEqual([]);
    expect(compactionsOf('sess-a', `${MAIN_HEADER}\n{"type":"compaction_state", broken`)).toEqual(
      [],
    );
    expect(compactionsOf('sess-a', stored({ timestamp: 'never' }))).toEqual([]);
  });
});

describe('summariesReport joins each compaction to its compact row', () => {
  test('a row at the same instant names the model and path', () => {
    const lines = summariesReport(
      [compaction({ text: REFUSAL })],
      [row({ model: 'haiku', path: 'reuse' })],
    );
    expect(lines.find((line) => line.startsWith('sess-a'))).toContain('  haiku  reuse  ');
  });

  test('a row up to two minutes earlier matches, one millisecond more does not', () => {
    const inside = summariesReport(
      [compaction({ text: REFUSAL })],
      [row({ at: NOON - JOIN_WINDOW_MS })],
    );
    const outside = summariesReport(
      [compaction({ text: REFUSAL })],
      [row({ at: NOON - JOIN_WINDOW_MS - 1 })],
    );
    expect(inside.join('\n')).not.toContain(NO_LOG_LINE);
    expect(outside.join('\n')).toContain(`${UNKNOWN_MODEL}  ${NO_LOG_LINE}`);
  });

  test('a row after the compaction never matches', () => {
    const lines = summariesReport([compaction({ text: REFUSAL })], [row({ at: NOON + 1 })]);
    expect(lines.join('\n')).toContain(NO_LOG_LINE);
  });

  test('the newest eligible row wins', () => {
    const lines = summariesReport(
      [compaction({ text: REFUSAL })],
      [
        row({ at: NOON - 30 * SECOND, path: 'newest' }),
        row({ at: NOON - 60 * SECOND, path: 'older' }),
        row({ at: NOON + SECOND, path: 'later' }),
      ],
    );
    expect(lines.find((line) => line.startsWith('sess-a'))).toContain('  newest  ');
  });

  test('a row of another session is ignored', () => {
    const lines = summariesReport([compaction({ text: REFUSAL })], [row({ sessionId: 'sess-b' })]);
    expect(lines.join('\n')).toContain(NO_LOG_LINE);
  });
});

describe('summariesReport classifies and counts', () => {
  const compactions = [
    compaction({ sessionId: 'a1' }),
    compaction({ sessionId: 'a2' }),
    compaction({ sessionId: 'a3', text: REFUSAL }),
    compaction({ sessionId: 'b1', text: REFUSAL }),
    compaction({ sessionId: 'c1' }),
  ];
  const rows = [
    row({ sessionId: 'a1', path: 'reuse' }),
    row({ sessionId: 'a2', path: 'reuse' }),
    row({ sessionId: 'a3', path: 'reuse' }),
    row({ sessionId: 'b1', path: 'no-snapshot' }),
  ];
  const lines = summariesReport(compactions, rows);

  test('the table has one row per path, in the order of the compaction paths', () => {
    expect(lines.slice(0, 4)).toEqual([
      'path         summaries  not summaries',
      'reuse                2              1',
      'no-snapshot          0              1',
      'no log line          1              0',
    ]);
  });

  test('one line follows for each flagged summary and none for a real one', () => {
    const startsWithAny = (ids: readonly string[]) =>
      lines.filter((line) => ids.some((id) => line.startsWith(`${id}  `)));
    expect(startsWithAny(['a3', 'b1'])).toHaveLength(2);
    expect(startsWithAny(['a1', 'a2', 'c1'])).toEqual([]);
  });

  test('the verdict names every path the flagged ones came out of', () => {
    expect(lines.at(-1)).toBe(
      'the check flags 2 of 5 summaries; they came out of reuse (1) and no-snapshot (1).',
    );
  });
});

describe('flagged lines and verdicts read as plain text', () => {
  test('a flagged line has id, time, kind, model, path, length and a one-line start', () => {
    const lines = summariesReport(
      [compaction({ sessionId: 'sub-1', subagent: true, text: REFUSAL })],
      [row({ sessionId: 'sub-1', model: 'haiku', path: 'reuse' })],
    );
    expect(lines.find((line) => line.startsWith('sub-1'))).toBe(
      `sub-1  ${NOON_ISO}  subagent  haiku  reuse  ${REFUSAL.length} chars  I won't write that summary. I'm still in the middle of the exploration.`,
    );
  });

  test('the start is cut at 100 characters', () => {
    const long = 'word '.repeat(60);
    const lines = summariesReport([compaction({ text: long })], [row()]);
    const flagged = lines.find((line) => line.startsWith('sess-a')) ?? '';
    const start = flagged.split('  ').at(-1) ?? '';
    expect(start).toHaveLength(PREVIEW_CHARS);
    expect(start).toBe(long.slice(0, PREVIEW_CHARS));
  });

  test('every flagged summary from one path says so in one clause', () => {
    const lines = summariesReport(
      [compaction({ text: REFUSAL }), compaction({ sessionId: 'sess-b' })],
      [row(), row({ sessionId: 'sess-b' })],
    );
    expect(lines.at(-1)).toBe(
      'the check flags 1 of 2 summaries; every flagged one came out of reuse.',
    );
  });

  test('no flagged summaries gives a short verdict and no list', () => {
    const lines = summariesReport([compaction()], [row()]);
    expect(lines.at(-1)).toBe('the check flags 0 of 1 summaries.');
    expect(lines).toHaveLength(4);
  });

  test('a brief appended after a refusal does not rescue the refusal', () => {
    const text = `${REFUSAL}\n\n${PARENT_BRIEF_LEAD}\n\n${SUMMARY}`;
    const lines = summariesReport([compaction({ text })], [row()]);
    expect(lines.at(-1)).toContain('flags 1 of 1');
  });

  test('an adaptive summary passes and a refusal with headings of its own is flagged', () => {
    const lines = summariesReport(
      [
        compaction({ sessionId: 'adaptive', text: ADAPTIVE_STORED }),
        compaction({ sessionId: 'headed', text: STORED_REFUSAL_WITH_HEADINGS }),
      ],
      [row({ sessionId: 'adaptive' }), row({ sessionId: 'headed' })],
    );
    expect(lines.at(-1)).toBe(
      'the check flags 1 of 2 summaries; every flagged one came out of reuse.',
    );
    expect(lines.find((line) => line.startsWith('headed'))).toBeDefined();
    expect(lines.find((line) => line.startsWith('adaptive'))).toBeUndefined();
  });

  test('no compactions at all gives a plain sentence', () => {
    expect(summariesReport([], [row()])).toEqual(['no stored summaries were found in that range.']);
  });
});
