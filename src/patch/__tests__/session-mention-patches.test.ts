import { describe, expect, test } from 'bun:test';

import { patchSource } from '../../binary/apply.ts';
import { joinApp } from '../../binary/graph.ts';
import { sessionIndexPatches } from '../session-index-patches.ts';
import { sessionListPatches } from '../session-list-patches.ts';
import {
  SESSION_PROMPT_LINE,
  sessionMentionPatches,
  TRANSCRIPT_HEAD_BYTES,
} from '../session-mention-patches.ts';
import { freeNames } from '../tokens.ts';
import { payloadFunction } from './payload.ts';
import type { Hash, Head } from './session-mention-harness.ts';
import { picker, session, stock, transcript, userLine } from './session-mention-harness.ts';

const contracted = [...sessionIndexPatches, ...sessionMentionPatches, ...sessionListPatches];

function headsOf(texts: Readonly<Record<string, string | null>>): Map<string, Head> {
  return new Map(Object.entries(texts).map(([id, text]) => [id, { text, branch: null }]));
}

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

  test.each(['#659', 'issue #659', '#6', '#0042', '#659 ', 'issue #659 fix'])(
    '%j is an issue number, so it does not open',
    (text) => {
      expect(queryAtEnd(text)).toBeNull();
    },
  );

  test.each([
    ['#a1b2', { query: 'a1b2', start: 0 }],
    ['#659x', { query: '659x', start: 0 }],
    ['#feat 659', { query: 'feat 659', start: 0 }],
  ])('%j holds more than digits, so it opens with its query', (text, hash) => {
    expect(queryAtEnd(text)).toEqual(hash);
  });

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

describe('matching also reads the first message the user typed', () => {
  const pool = picker.$ODsessionPool(SESSIONS, 'dddd4444');
  const heads = headsOf({
    aaaa1111: 'the vpisem field is empty',
    bbbb2222: 'Compare Zellij panes',
    eeee5555: null,
  });
  const ids = (query: string, max = 100) =>
    picker.$ODsessionMatches(pool, query, max, heads).map((row) => row.id);

  test('a word in the first message matches, in any case', () => {
    expect(ids('VPISEM')).toEqual(['aaaa1111']);
  });

  test('a word in the title still matches', () => {
    expect(ids('stock')).toEqual(['eeee5555']);
  });

  test('words may be split between the title and the first message', () => {
    expect(ids('lag vpisem')).toEqual(['aaaa1111']);
    expect(ids('zellij evaluate')).toEqual(['bbbb2222']);
  });

  test('a word that is in neither the title nor the first message leaves the session out', () => {
    expect(ids('lag zellij')).toEqual([]);
  });

  test('a prefix of the session id matches without a first message', () => {
    expect(ids('eeee55')).toEqual(['eeee5555']);
  });

  test('a session whose first message is unknown matches by title only', () => {
    expect(ids('bugs')).toEqual(['eeee5555']);
    expect(ids('vpisem bugs')).toEqual([]);
  });

  test('title matches come first, then sessions that match only by first message, newest first', () => {
    const mixed = [
      session('m1', 'Other', 1),
      session('m2', 'About herdr', 2),
      session('m3', 'Other', 3),
      session('m4', 'Herdr again', 4),
    ];
    const text = headsOf({ m1: 'herdr in the first message', m3: 'herdr in the first message' });
    expect(picker.$ODsessionMatches(mixed, 'herdr', 100, text).map((row) => row.id)).toEqual([
      'm2',
      'm4',
      'm1',
      'm3',
    ]);
  });

  test('the row cap counts both kinds, title matches first', () => {
    const mixed = [
      session('m1', 'Other', 1),
      session('m2', 'About herdr', 2),
      session('m3', 'Herdr again', 3),
    ];
    const text = headsOf({ m1: 'herdr' });
    const cut = (max: number) =>
      picker.$ODsessionMatches(mixed, 'herdr', max, text).map((row) => row.id);
    expect(cut(2)).toEqual(['m2', 'm3']);
    expect(cut(3)).toEqual(['m2', 'm3', 'm1']);
  });
});

describe('matching also reads the repo, the branch and the path', () => {
  const pool = [
    { ...session('r1', 'Fix lag', 1), cwd: '/work/dotfiles/macos' },
    { ...session('r2', 'Fix lag', 2), cwd: '/work/ovrdroid' },
    { ...session('r3', 'Fix lag', 3), cwd: '/work/ovrdroid' },
  ];
  const heads = new Map<string, Head>([
    ['r2', { text: 'first message', branch: 'feature/picker' }],
    ['r3', { text: 'first message', branch: 'main' }],
  ]);
  const ids = (query: string) =>
    picker.$ODsessionMatches(pool, query, 100, heads).map((row) => row.id);

  test('a word in the path matches, even when no first message is known', () => {
    expect(ids('dotfiles')).toEqual(['r1']);
    expect(ids('macos')).toEqual(['r1']);
  });

  test('a word in the branch matches', () => {
    expect(ids('picker')).toEqual(['r2']);
  });

  test('a repo word and a branch word narrow together', () => {
    expect(ids('ovrdroid main')).toEqual(['r3']);
    expect(ids('ovrdroid lag')).toEqual(['r2', 'r3']);
  });

  test('a word in none of the title, repo, branch or path leaves the session out', () => {
    expect(ids('dotfiles picker')).toEqual([]);
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

describe('each item carries what the list draws and what Enter inserts', () => {
  const first: Head = { text: 'the herdr panel stutters', branch: 'main' };
  const [item] = picker.$ODsessionItems(
    [{ ...session('abc', 'Fix  the\nlag', 1), cwd: undefined }],
    () => first,
  );

  test('the title with its whitespace collapsed', () => {
    expect(item?.label).toBe('Fix the lag');
  });

  test('the tag and the session id for the selection', () => {
    expect(item?.value).toBe('#session-abc');
    expect(item?.$ODsession).toBe('abc');
  });

  test('the session, its transcript head and its place', () => {
    expect(item?.$ODrow?.id).toBe('abc');
    expect(item?.$ODhead).toBe(first);
    expect(item?.$ODplace).toEqual({ label: '', root: true });
  });

  test('an untitled session uses the /sessions wording', () => {
    const [untitled] = picker.$ODsessionItems([session('a', '', 1)], () => null);
    expect(untitled?.label).toBe('Untitled');
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
    expect(picker.$ODsessionText(raw).text).toBe(first);
  });

  test('ascii-escaped unicode decodes too', () => {
    const line = userLine('caf\u00E9').replace('\u00E9', String.raw`\u00e9`);
    expect(picker.$ODsessionText(transcript(line)).text).toBe('caf\u00E9');
  });

  test('a string content counts as typed text', () => {
    const line = JSON.stringify({
      type: 'message',
      id: 'm1',
      message: { role: 'user', content: 'hi' },
    });
    expect(picker.$ODsessionText(transcript(line)).text).toBe('hi');
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
      picker.$ODsessionText(transcript(image, toolResult, userLine('Actual typed request'))).text,
    ).toBe('Actual typed request');
  });

  test('a hidden record cut by the read limit is not shown as typed', () => {
    const hidden = userLine(`Hidden runtime context ${'x'.repeat(150_000)}`, {
      visibility: 'llm_only',
    });
    const raw = transcript(hidden).slice(0, TRANSCRIPT_HEAD_BYTES);
    expect(picker.$ODsessionText(raw).text).toBeNull();
  });

  test('a typed message cut by the read limit shows one line', () => {
    const raw = transcript(userLine(`long ask ${'word '.repeat(50)}`));
    expect(picker.$ODsessionText(raw.slice(0, raw.lastIndexOf('word'))).text).toBeNull();
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
