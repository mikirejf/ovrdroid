import { describe, expect, test } from 'bun:test';

import {
  contextLine,
  picker,
  transcript,
  transcriptWith,
  userLine,
} from './session-mention-harness.ts';

const STATUS = '% git status --short --branch';

function statusOf(line: string): string {
  return `<context>\n${STATUS}\n## ${line}\n\n% git log --oneline -5\nabc fix\n</context>`;
}

describe('the branch is the one git status printed in the first context message', () => {
  test.each([
    ['main...origin/main', 'main'],
    ['feat/session-list...origin/feat/session-list [ahead 2, behind 1]', 'feat/session-list'],
    ['scratch', 'scratch'],
    ['No commits yet on fresh', 'fresh'],
  ])('%j is %j', (line, branch) => {
    expect(picker.$ODstatusBranch(statusOf(line))).toBe(branch);
  });

  test('a detached HEAD has no branch', () => {
    expect(picker.$ODstatusBranch(statusOf('HEAD (no branch)'))).toBeNull();
  });

  test('a context without git status has no branch', () => {
    expect(picker.$ODstatusBranch('tool list')).toBeNull();
  });

  test('the transcript read returns the branch next to the first message', () => {
    const raw = transcriptWith(contextLine(statusOf('main...origin/main')), userLine('fix it'));
    expect(picker.$ODsessionText(raw)).toMatchObject({ text: 'fix it', branch: 'main' });
  });

  test('a later context message never replaces the first one', () => {
    const later = contextLine(statusOf('other'), 'context-m2');
    const raw = transcriptWith(contextLine('no status here'), later, userLine('fix it'));
    expect(picker.$ODsessionText(raw).branch).toBeNull();
  });

  test('a session with no context message has no branch', () => {
    expect(picker.$ODsessionText(transcript(userLine('fix it'))).branch).toBeNull();
  });
});

describe('the first message is cleaned for display', () => {
  const ID = '44ef2e60-1b2c-4d5e-8f90-a1b2c3d4e5f6';

  test('a session tag shrinks to eight hex digits', () => {
    expect(picker.$ODshown(`see #session-${ID} now`)).toBe('see #44ef2e60 now');
  });

  test('a bare id shrinks to eight hex digits', () => {
    expect(picker.$ODshown(`continue ${ID}`)).toBe('continue 44ef2e60');
  });

  test('a leading /delegate goes, one later in the text stays', () => {
    expect(picker.$ODshown('/delegate run /delegate again')).toBe('run /delegate again');
  });

  test('every system block is gone and whitespace collapses', () => {
    const typed = userLine('<system-anything>\nx\n</system-anything>\nfix\n\n the  lag');
    expect(picker.$ODsessionText(transcript(typed)).text).toBe('fix the lag');
  });

  test('a system block left open runs to the end of the message', () => {
    const typed = userLine('fix the lag\n<system-reminder>\nnever closed');
    expect(picker.$ODsessionText(transcript(typed)).text).toBe('fix the lag');
  });
});

describe('the time cell says how long ago the session was last active', () => {
  const NOW = Date.UTC(2026, 0, 30);
  const ago = (minutes: number): string => picker.$ODage(NOW - minutes * 60_000, NOW);

  test.each([
    [0, 'now'],
    [0.9, 'now'],
    [1, '1m'],
    [59, '59m'],
    [60, '1h'],
    [23 * 60, '23h'],
    [24 * 60, '1d'],
    [13 * 1440, '13d'],
    [14 * 1440, '2w'],
    [59 * 1440, '8w'],
    [60 * 1440, '2mo'],
  ])('%d minutes ago is %j', (minutes, text) => {
    expect(ago(minutes)).toBe(text);
  });

  test('a date works like a number', () => {
    expect(picker.$ODage(new Date(NOW - 5 * 60_000), NOW)).toBe('5m');
  });
});

describe('cutting text at its start, for the repo label and the path', () => {
  test('the start is cut with an ellipsis', () => {
    expect(picker.$ODfitStart('staging-deploy', 8)).toBe('\u2026-deploy');
    expect(picker.$ODfitStart('dub', 8)).toBe('dub');
  });

  test('wide characters count as two cells', () => {
    expect(picker.$ODfitStart('\u7D44'.repeat(10), 7)).toBe(`\u2026${'\u7D44'.repeat(3)}`);
  });

  test('no room leaves nothing', () => {
    expect(picker.$ODfitStart('abc', 0)).toBe('');
  });
});

describe('wrapping the first message', () => {
  test('words wrap at the width', () => {
    expect(picker.$ODwrap('one two three four', 9, 3)).toEqual(['one two', 'three', 'four']);
  });

  test('the last line is cut at the end when there is more', () => {
    expect(picker.$ODwrap('one two three four five six', 9, 2)).toEqual([
      'one two',
      'three fo\u2026',
    ]);
  });

  test('a word longer than the width is broken', () => {
    expect(picker.$ODwrap('abcdefghij', 4, 3)).toEqual(['abcd', 'efgh', 'ij']);
  });

  test('every line fits in cells, wide characters too', () => {
    for (const line of picker.$ODwrap(`${'\u7D44'.repeat(30)} x`, 9, 4)) {
      expect(Bun.stringWidth(line)).toBeLessThanOrEqual(9);
    }
  });
});

describe('the band colour comes from the theme', () => {
  test('it mixes the user message background toward the text colour', () => {
    expect(picker.$ODblend('#262626', '#eeeeee', 0.1)).toBe('#3a3a3a');
    expect(picker.$ODblend('#e8e8e8', '#1a1a1a', 0.1)).toBe('#d3d3d3');
  });

  test('a colour that is not hex is kept as it is, and none stays none', () => {
    expect(picker.$ODblend('gray', '#eeeeee', 0.1)).toBe('gray');
    expect(picker.$ODblend('', '#eeeeee', 0.1)).toBeUndefined();
  });
});
