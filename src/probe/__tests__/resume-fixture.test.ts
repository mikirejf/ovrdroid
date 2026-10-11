import { describe, expect, test } from 'bun:test';

import { LAST_MARKER, resumeFixture } from '../resume-fixture.ts';

const ID = '11111111-2222-4333-8444-555555555555';
const CWD = '/work/project';
const TURNS = 4;
const RECORDS_PER_TURN = 5;

interface Message {
  role: string;
  content: { type: string; text?: string; id?: string; tool_use_id?: string; name?: string }[];
}

interface FixtureRecord {
  type: string;
  id?: string;
  parentId?: string;
  seq?: number;
  owner?: string;
  cwd?: string;
  turnId?: string;
  message?: Message;
}

function isRecord(value: unknown): value is FixtureRecord {
  return typeof value === 'object' && value !== null && 'type' in value;
}

function parseRecord(line: string): FixtureRecord[] {
  const value: unknown = JSON.parse(line);
  return isRecord(value) ? [value] : [];
}

function recordsOf(turns: number): FixtureRecord[] {
  const { transcript } = resumeFixture({ id: ID, cwd: CWD, owner: 'tester', turns });
  return transcript
    .trimEnd()
    .split('\n')
    .flatMap((line) => parseRecord(line));
}

function messagesOf(records: readonly FixtureRecord[]): FixtureRecord[] {
  return records.filter((record) => record.type === 'message');
}

describe('resumeFixture writes a transcript Droid accepts', () => {
  test('the first line is the session_start Droid validates, with the owner it requires', () => {
    const [start] = recordsOf(TURNS);
    expect(start).toMatchObject({ type: 'session_start', id: ID, owner: 'tester', cwd: CWD });
  });

  test('each turn is a prompt, a tool call, its result, a reply and a turn outcome', () => {
    const records = recordsOf(TURNS);
    expect(records).toHaveLength(1 + TURNS * RECORDS_PER_TURN);
    expect(records.slice(1, 1 + RECORDS_PER_TURN).map((record) => record.type)).toEqual([
      'message',
      'message',
      'message',
      'message',
      'agent_turn_outcome',
    ]);
  });

  test('every tool call is answered by a result carrying its id', () => {
    const blocks = messagesOf(recordsOf(TURNS)).flatMap((record) => record.message?.content ?? []);
    const calls = blocks.filter((block) => block.type === 'tool_use').map((block) => block.id);
    const results = blocks
      .filter((block) => block.type === 'tool_result')
      .map((block) => block.tool_use_id);
    expect(calls).toHaveLength(TURNS);
    expect(results).toEqual(calls);
  });

  test('messages form one parent chain with seq counting up from zero', () => {
    const messages = messagesOf(recordsOf(TURNS));
    expect(messages.map((record) => record.seq)).toEqual(messages.map((_, index) => index));
    expect(messages[0]?.parentId).toBeUndefined();
    for (const [index, record] of messages.entries()) {
      if (index > 0) {
        expect(record.parentId).toBe(messages[index - 1]?.id);
      }
    }
    expect(new Set(messages.map((record) => record.id)).size).toBe(messages.length);
  });

  test('a turn outcome names the prompt that opened its turn', () => {
    const records = recordsOf(TURNS);
    const outcome = records.find((record) => record.type === 'agent_turn_outcome');
    expect(outcome?.turnId).toBe(records[1]?.id);
  });

  test('the replies carry markdown lists and code blocks in all three languages', () => {
    const replies = messagesOf(recordsOf(3))
      .filter((record) => record.message?.role === 'assistant')
      .flatMap((record) => record.message?.content ?? [])
      .map((block) => block.text ?? '')
      .join('\n');
    expect(replies).toContain('- It allocates');
    expect(replies).toContain('```ts');
    expect(replies).toContain('```python');
    expect(replies).toContain('```bash');
  });

  test('the tools differ across turns', () => {
    const names = messagesOf(recordsOf(3))
      .flatMap((record) => record.message?.content ?? [])
      .filter((block) => block.type === 'tool_use')
      .map((block) => block.name);
    expect(new Set(names)).toEqual(new Set(['Read', 'Execute', 'Grep']));
  });
});

describe('the last reply is the only place the marker appears', () => {
  test('the marker closes the final assistant reply and occurs once', () => {
    const { transcript, lastMarker } = resumeFixture({
      id: ID,
      cwd: CWD,
      owner: 'tester',
      turns: TURNS,
    });
    expect(lastMarker).toBe(LAST_MARKER);
    expect(transcript.split(LAST_MARKER)).toHaveLength(2);
    const lastReply = messagesOf(recordsOf(TURNS)).at(-1)?.message?.content.at(-1)?.text;
    expect(lastReply?.endsWith(LAST_MARKER)).toBe(true);
  });

  test('the same options give the same bytes', () => {
    const options = { id: ID, cwd: CWD, owner: 'tester', turns: TURNS };
    expect(resumeFixture(options).transcript).toBe(resumeFixture(options).transcript);
  });
});
