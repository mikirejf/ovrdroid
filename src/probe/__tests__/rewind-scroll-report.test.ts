import { describe, expect, test } from 'bun:test';

import {
  forkReading,
  HISTORY_HEADER,
  lastAnswerLine,
  promptFor,
  readChat,
  restoredVerdict,
  REWIND_MENU_TITLE,
  rewoundVerdict,
  settledVerdict,
  shownVerdict,
  topicsFor,
  untouchedVerdict,
} from '../rewind-scroll-report.ts';

const RUN = 'r1';
const TOPICS = topicsFor(4);

function chat(...topics: string[]): string[] {
  return topics.flatMap((topic) => [
    `   ${promptFor(topic, RUN)}`,
    '',
    `⛬  Answer for ${topic}, line 1 of 24.`,
    `   ${lastAnswerLine(topic)}`,
  ]);
}

const MENU = [
  '╭────╮',
  `│ ${REWIND_MENU_TITLE} │`,
  `│ > 10  ${promptFor('DELTA', RUN)} │`,
  `│   4   ${promptFor('ALPHA', RUN)} │`,
  '╰────╯',
];

function history(...topics: string[]): string[] {
  return [...chat(...topics), '', ` ${HISTORY_HEADER} · page 1 · Esc to live`, '', ...MENU];
}

describe('topicsFor', () => {
  test('names a short chat with words and a long one with numbers', () => {
    expect(topicsFor(4)).toEqual(['ALPHA', 'BRAVO', 'CHARLIE', 'DELTA']);
    expect(topicsFor(5)[4]).toBe('TURN005');
  });

  test('refuses a chat too short to move through', () => {
    expect(() => topicsFor(3)).toThrow(RangeError);
  });
});

describe('readChat', () => {
  test('reads only the chat above the menu, not the menu rows', () => {
    const reading = readChat(history('BRAVO', 'CHARLIE'), TOPICS);
    expect(reading.menuOpen).toBe(true);
    expect(reading.historyShown).toBe(true);
    expect(reading.prompts).toEqual(['BRAVO', 'CHARLIE']);
    expect(reading.firstPromptRow).toBe(0);
    expect(reading.answers).toEqual(['BRAVO', 'CHARLIE']);
  });

  test('a live chat with no menu has neither menu nor history view', () => {
    const reading = readChat(chat('ALPHA', 'DELTA'), TOPICS);
    expect(reading.menuOpen).toBe(false);
    expect(reading.historyShown).toBe(false);
    expect(reading.prompts).toEqual(['ALPHA', 'DELTA']);
  });
});

describe('shownVerdict', () => {
  test('passes when the chosen message opens the history view', () => {
    const verdict = shownVerdict('Down', 'BRAVO', readChat(history('BRAVO', 'CHARLIE'), TOPICS));
    expect(verdict.pass).toBe(true);
  });

  test('fails when a later message sits at the top', () => {
    const verdict = shownVerdict('Down', 'BRAVO', readChat(history('CHARLIE', 'DELTA'), TOPICS));
    expect(verdict.pass).toBe(false);
    expect(verdict.text).toContain('the topmost user message above the menu is CHARLIE');
  });

  test('fails when the message is too far down the chat', () => {
    const screen = ['a', 'b', 'c', 'd', 'e', ...history('BRAVO')];
    const verdict = shownVerdict('Down', 'BRAVO', readChat(screen, TOPICS));
    expect(verdict.pass).toBe(false);
    expect(verdict.text).toContain('not within the top');
  });

  test('fails when the chat never switched to the history view', () => {
    const screen = [...chat('BRAVO'), ...MENU];
    const verdict = shownVerdict('Down', 'BRAVO', readChat(screen, TOPICS));
    expect(verdict.pass).toBe(false);
    expect(verdict.text).toContain('never opened');
  });
});

describe('untouchedVerdict and restoredVerdict', () => {
  test('opening the menu leaves the live chat', () => {
    expect(untouchedVerdict(readChat([...chat('DELTA'), ...MENU], TOPICS)).pass).toBe(true);
    expect(untouchedVerdict(readChat(history('DELTA'), TOPICS)).pass).toBe(false);
  });

  test('Esc must close the menu, leave the history view and show the newest answer', () => {
    expect(restoredVerdict(readChat(chat('CHARLIE', 'DELTA'), TOPICS), 'DELTA').pass).toBe(true);
    const stuck = restoredVerdict(readChat(history('DELTA'), TOPICS), 'DELTA');
    expect(stuck.pass).toBe(false);
    expect(stuck.text).toContain('the rewind menu is still open');
    expect(stuck.text).toContain('the transcript history view is still showing');
  });

  test('after the rewind both the menu and the history view must be gone', () => {
    expect(settledVerdict(readChat(chat('ALPHA'), TOPICS)).pass).toBe(true);
    expect(settledVerdict(readChat(history('ALPHA'), TOPICS)).pass).toBe(false);
  });
});

describe('rewoundVerdict', () => {
  const transcript = [promptFor('ALPHA', RUN), promptFor('BRAVO', RUN)].join('\n');

  test('passes when the fork keeps exactly the messages before the chosen one', () => {
    const verdict = rewoundVerdict(forkReading(transcript, TOPICS), TOPICS, 'CHARLIE');
    expect(verdict).toEqual({
      pass: true,
      text: 'Enter on CHARLIE rewound the chat to before it (kept ALPHA, BRAVO)',
    });
  });

  test('fails when the fork kept the chosen message', () => {
    const verdict = rewoundVerdict(forkReading(transcript, TOPICS), TOPICS, 'BRAVO');
    expect(verdict.pass).toBe(false);
    expect(verdict.text).toBe('Enter on BRAVO kept ALPHA, BRAVO, expected ALPHA');
  });

  test('fails when no fork was made', () => {
    expect(rewoundVerdict(forkReading(undefined, TOPICS), TOPICS, 'BRAVO').pass).toBe(false);
  });

  test('a long chat is summarised by its first and last kept message', () => {
    const topics = topicsFor(8);
    const kept = topics.slice(0, 6).map((topic) => promptFor(topic, RUN));
    const verdict = rewoundVerdict(forkReading(kept.join('\n'), topics), topics, 'TURN007');
    expect(verdict.text).toContain('kept 6 messages, TURN001 to TURN006');
  });
});
