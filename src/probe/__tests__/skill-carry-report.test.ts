import { describe, expect, test } from 'bun:test';

import { carriedSkill } from '../../patch/skill-carry-patches.ts';
import type { CarryRun } from '../skill-carry-report.ts';
import {
  CARRY_STEPS,
  carryOutcome,
  describeOutcome,
  describeTurn,
  readCarry,
} from '../skill-carry-report.ts';

const SKILL = 'fixture-skill';
const MARKER = 'FIXTURE-BODY';
const BLOCK = `<skill filePath="/work/.factory/skills/${SKILL}/SKILL.md">\n<name>${SKILL}</name>\n<description>A fixture. (project)</description>\n# Fixture\n${MARKER}\n</skill>`;
const TYPED = `<system-notification>\nThe user has selected the following skill for immediate execution by typing /${SKILL} in their message.\n${BLOCK}\n</system-notification>`;
const CARRIED = carriedSkill(SKILL, BLOCK);
const RELOAD = `Skills loaded earlier in this session, most recent first: "${SKILL}".\nIf you are about to perform a task related to any of these skills, re-invoke the skill using the Skill tool first to reload its full instructions.`;
const OTHER_RELOAD = RELOAD.replace(SKILL, 'another-skill');
const TYPED_STEP = 'the turn the skill was typed in';
const FIRST_COMPACTION = 'the turn after the first compaction';
const SECOND_COMPACTION = 'the turn after the second compaction';
const RESTART = 'the turn after a restart';
const TURNS = CARRY_STEPS.map(({ step, after }, index) => ({
  step,
  after,
  word: `word-${index + 1}`,
}));

interface Message {
  role: string;
  content: string | { type: string; text: string }[];
}

function user(...texts: string[]): Message {
  return { role: 'user', content: texts.map((text) => ({ type: 'text', text })) };
}

function summary(...notes: string[]): Message {
  return user(
    [
      'You summarized the conversation thus far earlier in this session, as follows:',
      '<summary>\nThe user asked for the word ok.\n</summary>',
      ...notes,
      'IMPORTANT: You wrote this summary earlier in this session.',
    ].join('\n\n'),
  );
}

function request(messages: readonly Message[], tools: readonly object[] = [{ name: 'Read' }]) {
  return JSON.stringify({ model: 'stub-stream', tools, messages });
}

function typedTurn(): string {
  return request([
    user('<system-reminder>context</system-reminder>'),
    user(`Say ok (word-1)\n\n${TYPED}`),
  ]);
}

function laterTurn(word: string, ...notes: string[]): string {
  return request([summary(...notes), user(`Say ok again (${word})`)]);
}

function run(bodies: readonly string[]): CarryRun {
  return { skill: SKILL, marker: MARKER, turns: TURNS, bodies };
}

function laterTurns(...notes: string[]): string[] {
  return TURNS.slice(1).map(({ word }) => laterTurn(word, ...notes));
}

function outcomeOf(bodies: readonly string[]) {
  return carryOutcome(readCarry(run(bodies)));
}

function linesOf(bodies: readonly string[]): string[] {
  return readCarry(run(bodies)).map((reading) => describeTurn(reading, SKILL));
}

describe('a build that carries the typed skill', () => {
  const bodies = [typedTurn(), ...laterTurns(CARRIED)];

  test('passes when every turn after a compaction holds the text once and no reload line names the skill', () => {
    expect(readCarry(run(bodies))).toEqual([
      { step: TYPED_STEP, typed: true, asked: true, copies: 1, carried: false, named: false },
      { step: FIRST_COMPACTION, typed: false, asked: true, copies: 1, carried: true, named: false },
      {
        step: SECOND_COMPACTION,
        typed: false,
        asked: true,
        copies: 1,
        carried: true,
        named: false,
      },
      { step: RESTART, typed: false, asked: true, copies: 1, carried: true, named: false },
    ]);
    expect(outcomeOf(bodies)).toBe('carried');
  });

  test('says where each turn holds the text', () => {
    expect(linesOf(bodies)).toEqual([
      `${TYPED_STEP}: the request holds the skill text once, in the message it was typed in`,
      `${FIRST_COMPACTION}: the request holds the skill text once, carried next to the summary`,
      `${SECOND_COMPACTION}: the request holds the skill text once, carried next to the summary`,
      `${RESTART}: the request holds the skill text once, carried next to the summary`,
    ]);
    expect(describeOutcome('carried')).toStartWith('PASS:');
  });

  test('a reload line for another skill does not count against it', () => {
    expect(outcomeOf([typedTurn(), ...laterTurns(CARRIED, OTHER_RELOAD)])).toBe('carried');
  });
});

describe('a stock build', () => {
  const bodies = [typedTurn(), ...laterTurns(RELOAD)];

  test('fails, because only the name is left after a compaction', () => {
    expect(outcomeOf(bodies)).toBe('lost');
    expect(linesOf(bodies).slice(1)).toEqual(
      [FIRST_COMPACTION, SECOND_COMPACTION, RESTART].map(
        (step) =>
          `${step}: the skill text is gone; the request only names "${SKILL}" and tells the model to reload it`,
      ),
    );
    expect(describeOutcome('lost')).toStartWith('FAIL:');
  });

  test('the title request and the summary request are not read as turns', () => {
    const title = request([user('Say ok (word-1)')], []);
    const summarizer = request(
      [user(`Please summarize the following conversation:\nUSER: Say ok (word-1)\n${TYPED}`)],
      [],
    );
    const reuse = request([
      summary(CARRIED),
      user('Say ok again (word-2)'),
      { role: 'assistant', content: [{ type: 'text', text: 'ok' }] },
      user('Summarize this conversation.'),
    ]);
    const readings = readCarry(run([title, typedTurn(), summarizer, reuse, ...laterTurns(RELOAD)]));
    expect(readings.map((reading) => reading.copies)).toEqual([1, 0, 0, 0]);
    expect(readings.map((reading) => reading.asked)).toEqual([true, true, true, true]);
  });
});

describe('runs that fail or prove nothing', () => {
  test('a turn whose request never arrived proves nothing', () => {
    const bodies = [typedTurn(), ...laterTurns(CARRIED).slice(0, 2)];
    expect(outcomeOf(bodies)).toBe('unproven');
    expect(linesOf(bodies).at(-1)).toBe(`${RESTART}: no request for it reached the stub model`);
    expect(describeOutcome('unproven')).toStartWith('UNPROVEN:');
  });

  test('a slash command that loaded no skill proves nothing', () => {
    const bodies = [request([user('Say ok (word-1)')]), ...laterTurns()];
    expect(outcomeOf(bodies)).toBe('unproven');
    expect(linesOf(bodies)[0]).toBe(
      `${TYPED_STEP}: typing /${SKILL} did not put the skill text in the request`,
    );
    expect(linesOf(bodies)[1]).toBe(
      `${FIRST_COMPACTION}: the skill text is gone and nothing names "${SKILL}"`,
    );
  });

  test('a typed message still in view after the compaction proves nothing', () => {
    const kept = request([summary(), user(`Say ok (word-1)\n\n${TYPED}`), user('again (word-2)')]);
    const bodies = [typedTurn(), kept, ...laterTurns(CARRIED).slice(1)];
    expect(outcomeOf(bodies)).toBe('unproven');
    expect(linesOf(bodies)[1]).toBe(
      `${FIRST_COMPACTION}: the request holds the skill text once, in the message it was typed in`,
    );
  });

  test('the text twice in one request fails', () => {
    const bodies = [typedTurn(), ...laterTurns(CARRIED, CARRIED)];
    expect(outcomeOf(bodies)).toBe('lost');
    expect(linesOf(bodies)[1]).toBe(
      `${FIRST_COMPACTION}: the request holds the skill text 2 times, carried next to the summary`,
    );
  });

  test('a carried skill that the reload line still names fails', () => {
    const bodies = [typedTurn(), ...laterTurns(CARRIED, RELOAD)];
    expect(outcomeOf(bodies)).toBe('lost');
    expect(linesOf(bodies)[1]).toBe(
      `${FIRST_COMPACTION}: the request holds the skill text once, carried next to the summary; the reload line still names "${SKILL}"`,
    );
  });

  test('a body that is not JSON is skipped', () => {
    expect(outcomeOf(['not json', typedTurn(), ...laterTurns(CARRIED)])).toBe('carried');
  });
});
