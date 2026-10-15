import { describe, expect, test } from 'bun:test';

import type { BodyRow, JsonObject } from '../bodies.ts';
import type { RebuildInput } from '../compaction-rebuild-report.ts';
import {
  rebuildCompactions,
  sessionRecords,
  SUMMARY_WRAPPER_HEAD,
  SUMMARY_WRAPPER_TAIL,
} from '../compaction-rebuild-report.ts';
import { askText, reuseBody } from './compaction-replay-harness.ts';

const SESSION = 'abcdef12-0000-4000-8000-000000000000';
const EPHEMERAL = { type: 'ephemeral' };

function text(value: string): JsonObject {
  return { type: 'text', text: value };
}

function message(id: string, role: string, ...content: JsonObject[]): JsonObject {
  return { type: 'message', id, timestamp: 'now', message: { role, content } };
}

function compaction(id: string, anchor: string, summary: string): JsonObject {
  return {
    type: 'compaction_state',
    id,
    summaryText: summary,
    systemInfoText: `info for ${summary}`,
    anchorMessage: { id: anchor, index: 1 },
  };
}

function firstTemplate(): BodyRow {
  return {
    t: 7,
    sessionId: 'old',
    assistantMessageId: 'old-1',
    route: 'anthropic',
    body: reuseBody(),
  };
}

function laterTemplate(): BodyRow {
  const messages = [
    { role: 'user', content: [text(`${SUMMARY_WRAPPER_HEAD}old${SUMMARY_WRAPPER_TAIL}`)] },
    { role: 'user', content: [text(askText())] },
  ];
  return {
    t: 9,
    sessionId: 'old',
    assistantMessageId: 'old-2',
    route: 'openai',
    body: reuseBody('', messages),
  };
}

const CONTEXT = message('context-1', 'user', text('c0'), text('c1'), text('c2'), text('c3'));

function firstSession(): JsonObject[] {
  return [
    { type: 'session_start', id: 'header' },
    CONTEXT,
    message('u1', 'user', text('Fix it.')),
    message('a1', 'assistant', text('Reading.')),
    message('u2', 'user', text('more')),
    message('a2', 'assistant', text('Done.')),
    compaction('s1', 'a1', 'first summary'),
  ];
}

function isObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function listOf(value: unknown): JsonObject[] {
  return Array.isArray(value) ? value.filter((item) => isObject(item)) : [];
}

function messagesOf(body: JsonObject): JsonObject[] {
  return listOf(body['messages']);
}

function only(rows: readonly BodyRow[]): BodyRow {
  const [row] = rows;
  if (row === undefined) {
    throw new Error('expected one row');
  }
  return row;
}

function rebuild(records: readonly JsonObject[], overrides: Partial<RebuildInput> = {}): BodyRow[] {
  return rebuildCompactions({
    sessionId: SESSION,
    records,
    templates: [firstTemplate(), laterTemplate()],
    compactions: [],
    keepLastTurn: false,
    ...overrides,
  });
}

describe('the first compaction', () => {
  const row = only(rebuild(firstSession()));
  const messages = messagesOf(row.body);

  test('covers the transcript from the file start and leaves the last turn out by default', () => {
    expect(messages.map((entry) => entry['role'])).toEqual([
      'user',
      'user',
      'assistant',
      'user',
      'user',
    ]);
    expect(messages.at(-1)).toEqual({ role: 'user', content: [text(askText())] });
    expect(JSON.stringify(messages)).not.toContain('Done.');
  });

  test('caches blocks 2 and 3 of the context message and the last block of the last message', () => {
    expect(messages[0]?.['content']).toEqual([
      text('c0'),
      text('c1'),
      { ...text('c2'), cache_control: EPHEMERAL },
      { ...text('c3'), cache_control: EPHEMERAL },
    ]);
    expect(messages.at(-2)?.['content']).toEqual([{ ...text('more'), cache_control: EPHEMERAL }]);
  });

  test('copies the template time, route and settings, and names the row after the session', () => {
    expect(row).toMatchObject({ t: 7, route: 'anthropic', sessionId: SESSION });
    expect(row.assistantMessageId).toBe('rebuild-abcdef12-1');
    expect(row.body['system']).toEqual(reuseBody()['system']);
    expect(row.body['model']).toBe('model-x');
  });

  test('keeping the last turn adds it and moves the last cache mark onto it', () => {
    const kept = messagesOf(only(rebuild(firstSession(), { keepLastTurn: true })).body);
    expect(kept.map((entry) => entry['role'])).toEqual([
      'user',
      'user',
      'assistant',
      'user',
      'assistant',
      'user',
    ]);
    expect(kept.at(-2)?.['content']).toEqual([{ ...text('Done.'), cache_control: EPHEMERAL }]);
    expect(kept.at(-3)?.['content']).toEqual([text('more')]);
  });
});

describe('a later compaction', () => {
  const records = [
    { type: 'session_start', id: 'header' },
    CONTEXT,
    message('u1', 'user', text('one')),
    message('a1', 'assistant', text('one done')),
    compaction('s1', 'a1', 'first summary'),
    message('u2', 'user', text('two')),
    message('a2', 'assistant', text('two done')),
    message('u3', 'user', text('three')),
    message('a3', 'assistant', text('three done')),
    compaction('s2', 'a3', 'second summary'),
  ];

  test('starts with the previous summary and the context message, then the new messages', () => {
    const row = only(rebuild(records, { compactions: [2] }));
    const messages = messagesOf(row.body);
    expect(messages[0]).toEqual({
      role: 'user',
      content: [
        text(`${SUMMARY_WRAPPER_HEAD}first summary${SUMMARY_WRAPPER_TAIL}`),
        { ...text('info for first summary'), cache_control: EPHEMERAL },
      ],
    });
    expect(messages[1]).toEqual({ role: 'user', content: [text('c0'), text('c1')] });
    expect(messages.slice(2, -1)).toEqual([
      { role: 'user', content: [text('two')] },
      { role: 'assistant', content: [text('two done')] },
      { role: 'user', content: [{ ...text('three'), cache_control: EPHEMERAL }] },
    ]);
    expect(messages.at(-1)).toEqual({ role: 'user', content: [text(askText())] });
    expect(row).toMatchObject({ t: 9, route: 'openai' });
    expect(row.assistantMessageId).toBe('rebuild-abcdef12-2');
  });

  test('keeping the last turn adds the final assistant message', () => {
    const messages = messagesOf(
      only(rebuild(records, { compactions: [2], keepLastTurn: true })).body,
    );
    expect(messages.at(-2)?.['content']).toEqual([
      { ...text('three done'), cache_control: EPHEMERAL },
    ]);
  });

  test('rebuilds every compaction when none is asked for', () => {
    expect(rebuild(records).map((row) => row.assistantMessageId)).toEqual([
      'rebuild-abcdef12-1',
      'rebuild-abcdef12-2',
    ]);
  });
});

describe('blocks keep only the keys the API takes', () => {
  const blocks: JsonObject[] = [
    { type: 'thinking', thinking: 'hm', signature: 'sig', extra: 1 },
    { type: 'redacted_thinking', data: 'xx', extra: 1 },
    { type: 'text', text: 'hi', citations: [] },
    { type: 'tool_use', id: 't1', name: 'Read', input: { a: 1 }, caller: 'x' },
    { type: 'image', source: { type: 'base64' }, extra: 1 },
    { type: 'mystery', anything: true },
  ];
  const results: JsonObject[] = [
    { type: 'tool_result', tool_use_id: 't1', content: 'ok', is_error: false, extra: 1 },
    { type: 'tool_result', tool_use_id: 't2', content: 'bad', is_error: true },
  ];
  const records = [
    CONTEXT,
    message('u1', 'user', text('go')),
    message('a1', 'assistant', ...blocks),
    message('u2', 'user', ...results),
    message('a2', 'assistant', text('last')),
    compaction('s1', 'a1', 'x'),
  ];
  const messages = messagesOf(only(rebuild(records)).body);

  test('assistant blocks lose their extra keys, and unknown types stay whole', () => {
    expect(messages[2]?.['content']).toEqual([
      { type: 'thinking', thinking: 'hm', signature: 'sig' },
      { type: 'redacted_thinking', data: 'xx' },
      { type: 'text', text: 'hi' },
      { type: 'tool_use', id: 't1', name: 'Read', input: { a: 1 } },
      { type: 'image', source: { type: 'base64' } },
      { type: 'mystery', anything: true },
    ]);
  });

  test('is_error is removed when false and kept when true', () => {
    const [ok, bad] = listOf(messages[3]?.['content']);
    expect(ok).toEqual({ type: 'tool_result', tool_use_id: 't1', content: 'ok' });
    expect(bad).toEqual({
      type: 'tool_result',
      tool_use_id: 't2',
      content: 'bad',
      is_error: true,
      cache_control: EPHEMERAL,
    });
  });
});

describe('messages with no content are skipped', () => {
  test('an empty assistant message neither appears nor counts as the last turn', () => {
    const records = [
      CONTEXT,
      message('u1', 'user', text('go')),
      message('a1', 'assistant', text('real')),
      message('u2', 'user', text('next')),
      message('a2', 'assistant'),
      compaction('s1', 'a1', 'x'),
    ];
    const roles = messagesOf(only(rebuild(records)).body).map((entry) => entry['role']);
    expect(roles).toEqual(['user', 'user', 'user']);
  });
});

describe('a rebuild that cannot be done fails loudly', () => {
  test('a template file with no first compaction request throws', () => {
    expect(() => rebuild(firstSession(), { templates: [laterTemplate()] })).toThrow(
      'holds no first compaction request',
    );
  });

  test('a template file with no later compaction request throws', () => {
    const records = [
      ...firstSession(),
      message('u9', 'user', text('x')),
      compaction('s2', 'u9', 'y'),
    ];
    expect(() => rebuild(records, { templates: [firstTemplate()], compactions: [2] })).toThrow(
      'holds no later compaction request',
    );
  });

  test('an unrelated body is not taken for a template', () => {
    const plain: BodyRow = { ...firstTemplate(), body: { model: 'm', system: [], messages: [] } };
    expect(() => rebuild(firstSession(), { templates: [plain] })).toThrow('no first compaction');
  });

  test('a compaction number the session lacks throws', () => {
    expect(() => rebuild(firstSession(), { compactions: [2] })).toThrow(
      'the session has 1 compactions, so compaction 2 does not exist',
    );
  });

  test('a transcript with no assistant message has no last turn to leave out', () => {
    const records = [CONTEXT, message('u1', 'user', text('go')), compaction('s1', 'u1', 'x')];
    expect(() => rebuild(records)).toThrow('no assistant message');
    expect(messagesOf(only(rebuild(records, { keepLastTurn: true })).body)).toHaveLength(3);
  });

  test('an anchor that is not in the session throws', () => {
    const records = [
      CONTEXT,
      message('u1', 'user', text('go')),
      message('a1', 'assistant', text('ok')),
      compaction('s1', 'missing', 'x'),
      message('u2', 'user', text('next')),
      message('a2', 'assistant', text('ok')),
      compaction('s2', 'a2', 'y'),
    ];
    expect(() => rebuild(records, { compactions: [2] })).toThrow('anchor message missing');
  });
});

describe('sessionRecords reads one record per line', () => {
  test('blank lines are dropped', () => {
    expect(sessionRecords('{"type":"a"}\n\n{"type":"b"}\n')).toEqual([
      { type: 'a' },
      { type: 'b' },
    ]);
  });

  test('a broken line is an error', () => {
    expect(() => sessionRecords('{"type":"a"}\nnot json\n')).toThrow();
  });
});
