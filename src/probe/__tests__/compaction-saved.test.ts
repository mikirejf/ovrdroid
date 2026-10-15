import { describe, expect, test } from 'bun:test';

import type { SavedReply } from '../compaction-saved.ts';
import { parseSaved, savedJson, savedName } from '../compaction-saved.ts';
import { fieldsOf } from '../fields.ts';

const THINKING = { type: 'thinking', thinking: 'I should keep working.', signature: 'abc' };

const SAVED: SavedReply = {
  row: 3,
  arm: 'no-mention',
  run: 2,
  warm: false,
  model: 'claude-haiku-5-5',
  latencyMs: 4200,
  content: [THINKING, { type: 'text', text: 'I will not.' }],
  stopReason: 'end_turn',
  usage: {
    inputTokens: 5,
    cacheRead: 100,
    cacheWrite: 7,
    write5m: 7,
    write1h: 0,
    outputTokens: 20,
  },
  error: undefined,
};

describe('a saved reply keeps what the API returned', () => {
  test('it reads back as it was written, thinking blocks included', () => {
    expect(parseSaved(JSON.parse(savedJson(SAVED)))).toEqual(SAVED);
  });

  test('the file carries stop_reason and the content array as returned', () => {
    const file = fieldsOf(JSON.parse(savedJson(SAVED)));
    expect(file.get('stop_reason')).toBe('end_turn');
    expect(file.get('content')).toEqual(SAVED.content);
  });

  test('a failed request keeps its error and has no usage', () => {
    const failed: SavedReply = {
      ...SAVED,
      content: [],
      stopReason: '',
      usage: undefined,
      error: '400 Bad Request: nope',
    };
    expect(parseSaved(JSON.parse(savedJson(failed)))).toEqual(failed);
  });

  test('a warm-up is marked as one', () => {
    const warm = { ...SAVED, warm: true, run: 0, arm: 'reuse' } as const;
    expect(parseSaved(JSON.parse(savedJson(warm))).warm).toBe(true);
  });
});

describe('parseSaved refuses files it cannot read as a reply', () => {
  test('a file from the older replay, with no content array, is refused', () => {
    expect(() => parseSaved({ row: 0, arm: 'reuse', run: 1, outcome: 'summary' })).toThrow(
      'not a saved compaction reply',
    );
  });

  test('an arm that does not exist is refused', () => {
    expect(() => parseSaved({ ...JSON.parse(savedJson(SAVED)), arm: 'alt' })).toThrow(
      'unknown arm "alt"',
    );
  });
});

describe('savedName', () => {
  test('a reply is named by row, arm and run, and a warm-up by row', () => {
    expect(savedName(SAVED)).toBe('row-3-no-mention-2.json');
    expect(savedName({ ...SAVED, warm: true })).toBe('row-3-warm.json');
  });
});
