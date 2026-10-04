import { describe, expect, test } from 'bun:test';

import { patchSource } from '../../binary/apply.ts';
import { joinApp } from '../../binary/graph.ts';
import { sessionIndexPatches } from '../session-index-patches.ts';
import {
  SESSION_PROMPT_LINE,
  sessionMentionPatches,
  TRANSCRIPT_HEAD_BYTES,
} from '../session-mention-patches.ts';
import { freeNames } from '../tokens.ts';
import { payloadFunction } from './payload.ts';
import type { Hash, Session } from './session-mention-harness.ts';
import { AGO, picker, session, stock, transcript, userLine } from './session-mention-harness.ts';

const contracted = [...sessionIndexPatches, ...sessionMentionPatches];

describe('every name of three characters or fewer in a payload is captured or owned', () => {
  test.each(contracted.map((patch) => [patch.name, patch] as const))('%s', (_name, patch) => {
    const known = new Set(
      [patch.find, patch.until ?? '', ...(patch.lookups ?? [])].flatMap((text) => freeNames(text)),
    );
    const stray = freeNames(patch.replace).filter(
      (name) => !name.startsWith('$OD') && !known.has(name),
    );
    expect(stray).toEqual([]);
  });
});

function queryAtEnd(text: string): Hash | null {
  return picker.$ODsessionQuery(text, text.length);
}

describe('a # opens the picker only where a session tag can start', () => {
  test.each([
    ['#', { query: '', start: 0 }],
    ['#plan', { query: 'plan', start: 0 }],
    ['fix #herdr', { query: 'herdr', start: 4 }],
    ['\t#a', { query: 'a', start: 1 }],
    ['#herdr remote lag', { query: 'herdr remote lag', start: 0 }],
    ['line one\n#next', { query: 'next', start: 9 }],
  ])('%j opens with its query', (text, hash) => {
    expect(queryAtEnd(text)).toEqual(hash);
  });

  test.each(['# Plan', '#  ', 'C#', 'x#y', 'plain text', '#abc\nmore', ''])(
    '%j does not open',
    (text) => {
      expect(queryAtEnd(text)).toBeNull();
    },
  );

  test('the query ends at the cursor, not at the end of the text', () => {
    expect(picker.$ODsessionQuery('#abc def', 4)).toEqual({ query: 'abc', start: 0 });
  });

  test('a cursor before the # does not open', () => {
    expect(picker.$ODsessionQuery('ab #cd', 2)).toBeNull();
  });
});

const SESSIONS = [
  session('aaaa1111', 'Fix herdr remote panel lag', 30),
  session('bbbb2222', 'Evaluate herdr for remote agent sessions', 5),
  { ...session('cccc3333', 'Worker for herdr', 1), isSubagent: true },
  session('dddd4444', 'Current session about herdr', 0),
  session('eeee5555', 'List stock Droid bugs', 60),
];

describe('the pool holds the sessions a tag can name, newest first', () => {
  const pool = picker.$ODsessionPool(SESSIONS, 'dddd4444');

  test('drops subagent sessions and the current session', () => {
    expect(pool.map((row) => row.id)).toEqual(['bbbb2222', 'aaaa1111', 'eeee5555']);
  });

  test('keeps every session when no session is current yet', () => {
    expect(picker.$ODsessionPool(SESSIONS, null)).toHaveLength(4);
  });
});

describe('matching narrows the pool without re-sorting it', () => {
  const pool = picker.$ODsessionPool(SESSIONS, 'dddd4444');
  const ids = (query: string, max = 100) =>
    picker.$ODsessionMatches(pool, query, max).map((row) => row.id);

  test('an empty query keeps the newest sessions', () => {
    expect(ids('')).toEqual(['bbbb2222', 'aaaa1111', 'eeee5555']);
  });

  test('every word must appear in the title, in any order and case', () => {
    expect(ids('REMOTE herdr')).toEqual(['bbbb2222', 'aaaa1111']);
    expect(ids('herdr lag')).toEqual(['aaaa1111']);
  });

  test('a prefix of the session id matches too', () => {
    expect(ids('EEEE55')).toEqual(['eeee5555']);
  });

  test('a query that names nothing leaves no rows, so the picker closes', () => {
    expect(ids('zzzqqq')).toEqual([]);
  });

  test('the list stops at the row cap', () => {
    expect(ids('', 2)).toEqual(['bbbb2222', 'aaaa1111']);
  });
});

describe('selecting a session writes the tag in place of the query', () => {
  test('at the end of the input', () => {
    expect(picker.$ODsessionComplete('see #herdr', 10, 'abc-123')).toEqual({
      newText: 'see #session-abc-123 ',
      newCursorPosition: 21,
    });
  });

  test('keeps the text after the cursor', () => {
    expect(picker.$ODsessionComplete('#her and more', 4, 'abc')).toEqual({
      newText: '#session-abc  and more',
      newCursorPosition: 13,
    });
  });
});

function rowLabel(row: Session, first: string | null, width = 120): string | undefined {
  return picker.$ODsessionItems([row], width, () => first)[0]?.label;
}

describe('each row reads like a compact /sessions row', () => {
  const [row] = picker.$ODsessionItems([session('abc', 'Fix  the\nlag', 1)], 120, () => null);

  test('shows the title, then the time ago and message count after two spaces', () => {
    expect(row?.label).toBe(`Fix the lag  ${AGO} \u00B7 4 messages`);
  });

  test('carries the session id for the selection', () => {
    expect(row?.value).toBe('#session-abc');
    expect(row?.$ODsession).toBe('abc');
  });

  test('a session with one message says message', () => {
    expect(rowLabel({ ...session('a', 'T', 1), messageCount: 1 }, null)).toEndWith('1 message');
  });

  test('an untitled session uses the /sessions wording', () => {
    expect(rowLabel(session('a', '', 1), null)).toStartWith('Untitled  ');
  });

  test('a long title is cut so the row fits the dropdown', () => {
    const width = 40;
    expect(rowLabel(session('a', 'x'.repeat(200), 1), null, width)?.length).toBeLessThanOrEqual(
      width - 8,
    );
  });
});

describe('a second line shows the first message the user typed', () => {
  const row = session('a', 'Fix the lag', 1);

  test('sits under the title, indented past the selection marker', () => {
    expect(rowLabel(row, 'the herdr panel stutters')).toBe(
      `Fix the lag  ${AGO} \u00B7 4 messages\n  the herdr panel stutters`,
    );
  });

  test('is cut at the end so it fits the dropdown on one line', () => {
    const width = 40;
    const second = rowLabel(row, 'y'.repeat(200), width)?.split('\n')[1];
    expect(second).toBe(`  ${'y'.repeat(width - 7)}\u2026`);
  });

  test.each([
    ['no first message was found', null],
    ['it repeats the title in another case', 'FIX THE LAG'],
    ['the title is how it starts', 'fix the lag in the herdr panel'],
  ])('is left out when %s', (_case, first) => {
    expect(rowLabel(row, first)).not.toContain('\n');
  });
});

const SKILL_BODY =
  '<system-notification>\nThe user has selected the following skill.\n<skill>do things</skill>\n</system-notification>';

describe('the first message is what the user typed, read from the transcript', () => {
  test.each([
    ['a plain message', transcript(userLine('Say ok')), 'Say ok'],
    [
      'reminders around the typed text',
      transcript(
        userLine('<system-reminder>\nopened a file\n</system-reminder>\n\nfix  the\n\nlag'),
      ),
      'fix the lag',
    ],
    [
      'a skill run with what was typed after it',
      transcript(
        userLine('Skill "delegate" activated: check the\nlogs', { visibility: 'user_only' }),
        userLine(`${SKILL_BODY}check the\nlogs`),
      ),
      '/delegate check the logs',
    ],
    [
      'a skill run with nothing typed after it',
      transcript(
        userLine('Skill "simplify" activated', { visibility: 'user_only' }),
        userLine(SKILL_BODY),
      ),
      '/simplify',
    ],
    [
      'a slash command whose skill text follows the typed text',
      transcript(userLine(`/delegate copy the files\n${SKILL_BODY}`)),
      '/delegate copy the files',
    ],
    [
      'a status notice the user never typed',
      transcript(
        userLine('MCP status: some server tools are unavailable.', { visibility: 'user_only' }),
        userLine('real ask'),
      ),
      'real ask',
    ],
    [
      'quotes, unicode and emoji escapes',
      transcript(userLine('say "caf\u00E9" \uD83D\uDE00 \\ done')),
      'say "caf\u00E9" \uD83D\uDE00 \\ done',
    ],
    ['a transcript with no message yet', transcript(), null],
  ])('%s', (_case, raw, first) => {
    expect(picker.$ODsessionText(raw)).toBe(first);
  });

  test('ascii-escaped unicode decodes too', () => {
    const line = userLine('caf\u00E9').replace('\u00E9', String.raw`\u00e9`);
    expect(picker.$ODsessionText(transcript(line))).toBe('caf\u00E9');
  });

  test('a string content counts as typed text', () => {
    const line = JSON.stringify({
      type: 'message',
      id: 'm1',
      message: { role: 'user', content: 'hi' },
    });
    expect(picker.$ODsessionText(transcript(line))).toBe('hi');
  });

  test('a tool result is not a typed message, even with text inside it', () => {
    const image = JSON.stringify({
      type: 'message',
      id: 'm0',
      message: {
        role: 'user',
        content: [{ type: 'image', source: { type: 'base64', data: 'AA' } }],
      },
    });
    const toolResult = JSON.stringify({
      type: 'message',
      id: 'm1',
      message: {
        role: 'user',
        content: [
          {
            type: 'tool_result',
            tool_use_id: 't1',
            content: [{ type: 'text', text: 'Tool-produced result' }],
          },
        ],
      },
    });
    expect(
      picker.$ODsessionText(transcript(image, toolResult, userLine('Actual typed request'))),
    ).toBe('Actual typed request');
  });

  test('a hidden record cut by the read limit is not shown as typed', () => {
    const hidden = userLine(`Hidden runtime context ${'x'.repeat(150_000)}`, {
      visibility: 'llm_only',
    });
    const raw = transcript(hidden).slice(0, TRANSCRIPT_HEAD_BYTES);
    expect(picker.$ODsessionText(raw)).toBeNull();
  });

  test('a typed message cut by the read limit shows one line', () => {
    const raw = transcript(userLine(`long ask ${'word '.repeat(50)}`));
    expect(picker.$ODsessionText(raw.slice(0, raw.lastIndexOf('word')))).toBeNull();
  });
});

const promptPatch = sessionMentionPatches.filter(
  (patch) => patch.name === 'session-mention-prompt',
);

describe.skipIf(stock === undefined)('the system prompt names the session tag', () => {
  const patched = stock === undefined ? '' : joinApp(patchSource(stock, promptPatch));

  test('the sentence lands once, as the exact text the model reads', () => {
    const start = patched.indexOf('- A \\`#session-');
    const end = patched.indexOf('\n', start);
    const evaluated = payloadFunction<[], string>([], `return \`${patched.slice(start, end)}\``)();
    expect(start).toBeGreaterThan(-1);
    expect(patched.indexOf('- A \\`#session-', start + 1)).toBe(-1);
    expect(evaluated).toBe(SESSION_PROMPT_LINE);
  });

  test('the sentence carries nothing that changes between requests', () => {
    expect(SESSION_PROMPT_LINE).not.toMatch(/\$\{|\d{4}-\d{2}|\/Users\//u);
  });
});
