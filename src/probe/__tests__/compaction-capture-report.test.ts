import { describe, expect, test } from 'bun:test';

import type { JsonObject } from '../bodies.ts';
import { describeRow, missingReuse, reuseRows, rowsFor } from '../compaction-capture-report.ts';
import { reuseBody, reuseMessages, stockCaptured } from './compaction-replay-harness.ts';

const SESSION = 'session-1';

function row(sessionId: string, body: JsonObject): string {
  return JSON.stringify({ t: 1, sessionId, assistantMessageId: 'm', route: 'anthropic', body });
}

const ORDINARY: JsonObject = {
  model: 'claude-opus-5-5',
  messages: [{ role: 'user', content: 'hi' }],
};

describe('rowsFor finds the compaction requests of one session in a bodies file', () => {
  const text = [
    row(SESSION, ORDINARY),
    '',
    row('other', reuseBody()),
    row(SESSION, reuseBody()),
    row(SESSION, stockCaptured()),
  ].join('\n');

  test('reports each row of the session with its 0-based line, kind and size', () => {
    const rows = rowsFor(text, SESSION);
    expect(rows.map(({ line, kind }) => [line, kind])).toEqual([
      [0, 'ordinary'],
      [3, 'reuse'],
      [4, 'stock'],
    ]);
    expect(rows[1]?.bytes).toBe(Buffer.byteLength(row(SESSION, reuseBody())));
    expect(rows[1]?.messages).toBe(reuseMessages().length);
    expect(rows[0]?.model).toBe('claude-opus-5-5');
  });

  test('keeps only the reuse rows', () => {
    expect(reuseRows(rowsFor(text, SESSION)).map(({ line }) => line)).toEqual([3]);
  });

  test('skips lines that are not JSON rows', () => {
    expect(rowsFor('not json\n{"sessionId":"session-1"}', SESSION)).toEqual([]);
  });
});

describe('messages for the caller', () => {
  test('missingReuse names what the session did send', () => {
    const rows = rowsFor([row(SESSION, ORDINARY), row(SESSION, ORDINARY)].join('\n'), SESSION);
    expect(missingReuse(rows, SESSION)).toContain(
      'rows for this session: 2 ordinary, 0 stock, 0 reuse',
    );
  });

  test('missingReuse says when the session left no rows', () => {
    expect(missingReuse([], SESSION)).toContain('rows for this session: none');
  });

  test('describeRow prints line, model, message count and size', () => {
    expect(
      describeRow(
        { line: 17, kind: 'reuse', model: 'claude-sonnet-5-5', messages: 13, bytes: 473_718 },
        'x.jsonl',
      ),
    ).toBe(
      'reuse compaction row at line 17 (0-based) of x.jsonl: model claude-sonnet-5-5, 13 messages, 473,718 bytes',
    );
  });
});
