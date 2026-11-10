import { describe, expect, test } from 'bun:test';

import { carriedSkill, skillCarryPatches } from '../skill-carry-patches.ts';
import { closureOf, declarationAround } from './module-closure.ts';
import { describeStrayNames, occurrences, patchNamed, payloadFunction } from './payload.ts';
import { shipped, stockDroid as stock, stockText } from './stock-scanner.ts';

describeStrayNames(skillCarryPatches);

interface Block {
  type: string;
  text?: string;
}

interface Message {
  role: string;
  content: readonly Block[] | string;
}

interface Previous {
  retainedSkills?: readonly string[];
  retainedSpec?: { path?: string; plan?: string; comment?: string } | null;
}

type CollectBindings = [
  e: { messages: readonly Message[] },
  t: Previous | undefined,
  c: string[],
  o: readonly string[],
  Et: (names: readonly string[]) => string[],
  _o: number,
];

const NAME_CAP = 50;
const OPEN = '<system-notification>';
const CLOSE = '</system-notification>';
const RHYME = '# Rhyme\n\nAlways answer in rhyme.';
const PROSE = '# Prose\n\nAlways answer in plain prose.';
const NAMES_LINE = 'names:';

const runCollect = payloadFunction<CollectBindings, string[]>(
  ['e', 't', 'c', 'o', 'Et', '_o'],
  `let $ODstock=[]${patchNamed(skillCarryPatches, 'compaction-keeps-typed-skill-text').replace.slice(0, -1)}`,
);

const runNote = payloadFunction<
  [
    e: Previous | undefined,
    nn: (spec: NonNullable<Previous['retainedSpec']>) => string | undefined,
  ],
  string[]
>(
  ['e', 'nn'],
  `${patchNamed(skillCarryPatches, 'compaction-note-shows-typed-skill-text').replace}"${NAMES_LINE}"+t.join(","));return o`,
);

function note(previous?: Previous): string[] {
  return runNote(previous, (spec) => spec.plan);
}

interface Scene {
  messages?: readonly Message[];
  previous?: readonly string[];
  loaded?: readonly string[];
}

function retained({ messages = [], previous, loaded = [] }: Scene): string[] {
  return runCollect(
    { messages },
    previous === undefined ? undefined : { retainedSkills: previous },
    [...loaded],
    previous ?? [],
    (names) => [...new Set(names)],
    NAME_CAP,
  );
}

function skillBlock(name: string, body: string): string {
  return `<skill filePath="/home/me/.agents/skills/${name}/SKILL.md">\n<name>${name}</name>\n<description>A fixture skill (personal)</description>\n${body}\n</skill>`;
}

function typedNotice(name: string, body: string): string {
  return `${OPEN}\nSkills provide specialized capabilities and domain knowledge. The user has selected the following skill for immediate execution by typing /${name} in their message; that token invokes the skill and is not a path or part of the request. Begin following the skill's instructions now.\n${skillBlock(name, body)}\n${CLOSE}`;
}

function user(text: string): Message {
  return { role: 'user', content: [{ type: 'text', text }] };
}

function typed(name: string, body: string, words = 'please start'): Message {
  return user(`${typedNotice(name, body)}\n\n${words}`);
}

function summaryMessage(list: readonly string[]): Message {
  return user(
    `You summarized the conversation thus far earlier in this session, as follows:\n\n<summary>\nThe user asked for a rhyme.\n</summary>\n\n${note({ retainedSkills: list }).join('\n\n')}\n\nIMPORTANT: You wrote this summary earlier in this session.`,
  );
}

const RHYME_UNIT = carriedSkill('rhyme', skillBlock('rhyme', RHYME));
const PROSE_UNIT = carriedSkill('prose', skillBlock('prose', PROSE));

describe('the retained skills list carries the text of a skill the user typed', () => {
  test('the skill block is carried word for word, without what the user wrote around it', () => {
    const list = retained({
      messages: [typed('rhyme', RHYME, 'UNIQUE-USER-WORDS')],
      loaded: ['rhyme'],
    });
    expect(list).toEqual([RHYME_UNIT, 'rhyme']);
    expect(RHYME_UNIT).toContain(RHYME);
    expect(list.join('\n')).not.toContain('UNIQUE-USER-WORDS');
    expect(list.join('\n')).not.toContain('Begin following');
  });

  test('skills the model loaded with the Skill tool leave the list as stock builds it', () => {
    expect(
      retained({
        messages: [user('load two skills')],
        previous: ['older'],
        loaded: ['first', 'second'],
      }),
    ).toEqual(['second', 'first', 'older']);
  });

  test('a second compaction keeps one copy, from the stored list alone or with the summary message in view', () => {
    const first = retained({ messages: [typed('rhyme', RHYME)], loaded: ['rhyme'] });
    expect(retained({ messages: [user('next message')], previous: first })).toEqual(first);
    expect(
      retained({ messages: [summaryMessage(first), user('next message')], previous: first }),
    ).toEqual(first);
  });

  test('a third compaction still returns the same list', () => {
    const first = retained({ messages: [typed('rhyme', RHYME)], loaded: ['rhyme'] });
    const second = retained({ messages: [summaryMessage(first)], previous: first });
    expect(retained({ messages: [summaryMessage(second)], previous: second })).toEqual(first);
  });

  test('typing the skill again after its file changed replaces the carried text', () => {
    const first = retained({ messages: [typed('rhyme', RHYME)], loaded: ['rhyme'] });
    const again = retained({
      messages: [typed('rhyme', PROSE)],
      previous: first,
      loaded: ['rhyme'],
    });
    expect(again).toEqual([carriedSkill('rhyme', skillBlock('rhyme', PROSE)), 'rhyme']);
  });

  test('two typed skills are both carried, the most recently typed first', () => {
    const first = retained({ messages: [typed('rhyme', RHYME)], loaded: ['rhyme'] });
    expect(
      retained({ messages: [typed('prose', PROSE)], previous: first, loaded: ['prose'] }),
    ).toEqual([PROSE_UNIT, RHYME_UNIT, 'prose', 'rhyme']);
    expect(
      retained({
        messages: [typed('rhyme', RHYME), user('work'), typed('prose', PROSE)],
        loaded: ['rhyme', 'prose'],
      }),
    ).toEqual([PROSE_UNIT, RHYME_UNIT, 'prose', 'rhyme']);
  });

  test('a body that shows a closing skill tag is carried whole', () => {
    const body = 'Write the tag `</skill>` like this:\n</skill>\nand keep going.';
    expect(retained({ messages: [typed('rhyme', body)], loaded: ['rhyme'] })).toEqual([
      carriedSkill('rhyme', skillBlock('rhyme', body)),
      'rhyme',
    ]);
  });

  test('only user text blocks are read', () => {
    const notice = typedNotice('rhyme', RHYME);
    expect(
      retained({
        messages: [
          { role: 'assistant', content: [{ type: 'text', text: notice }] },
          { role: 'user', content: notice },
          { role: 'user', content: [{ type: 'tool_result', text: notice }, { type: 'text' }] },
        ],
      }),
    ).toEqual([]);
  });

  test('a skill block that was not typed by the user is not carried', () => {
    const loaded = `${OPEN}\nThe Skill tool loaded this skill.\n${skillBlock('rhyme', RHYME)}\n${CLOSE}`;
    expect(retained({ messages: [user(loaded)], loaded: ['rhyme'] })).toEqual(['rhyme']);
    expect(retained({ messages: [user(skillBlock('rhyme', RHYME))], loaded: ['rhyme'] })).toEqual([
      'rhyme',
    ]);
  });

  test('the cap of 50 counts names, so a carried skill never pushes a name out', () => {
    const names = Array.from({ length: NAME_CAP + 5 }, (_unused, index) => `skill-${index}`);
    const list = retained({ messages: [typed('rhyme', RHYME)], loaded: names });
    expect(list).toHaveLength(NAME_CAP + 1);
    expect(list[0]).toBe(RHYME_UNIT);
    expect(list[1]).toBe(`skill-${NAME_CAP + 4}`);
  });
});

describe('the note after the summary shows carried skills in full', () => {
  test('with nothing carried, every name goes on the reload line', () => {
    expect(note({ retainedSkills: ['second', 'first'] })).toEqual([`${NAMES_LINE}second,first`]);
  });

  test('carried skills come first and leave the reload line', () => {
    expect(
      note({ retainedSkills: [PROSE_UNIT, RHYME_UNIT, 'prose', 'reviewing', 'rhyme'] }),
    ).toEqual([PROSE_UNIT, RHYME_UNIT, `${NAMES_LINE}reviewing`]);
  });

  test('the reload line is left out when every name is carried', () => {
    expect(note({ retainedSkills: [RHYME_UNIT, 'rhyme'] })).toEqual([RHYME_UNIT]);
  });

  test('a session with no retained skills gets no note', () => {
    expect(note({})).toEqual([]);
    expect(note()).toEqual([]);
  });

  test('a name that only starts like a carried one stays on the reload line', () => {
    expect(note({ retainedSkills: [RHYME_UNIT, 'rhyme', 'rhyme-two'] })).toEqual([
      RHYME_UNIT,
      `${NAMES_LINE}rhyme-two`,
    ]);
  });

  test.each([
    [[], []],
    [['reviewing'], [`${NAMES_LINE}reviewing`]],
    [[RHYME_UNIT, 'rhyme'], [RHYME_UNIT]],
    [
      [RHYME_UNIT, 'rhyme', 'reviewing'],
      [RHYME_UNIT, `${NAMES_LINE}reviewing`],
    ],
  ])('the spec precedes carried text and uncarried names: %j', (skills, expected) => {
    expect(note({ retainedSkills: skills, retainedSpec: { plan: 'approved plan' } })).toEqual([
      'approved plan',
      ...expected,
    ]);
    expect(note({ retainedSkills: skills })).toEqual(expected);
    expect(note({ retainedSkills: skills, retainedSpec: null })).toEqual(expected);
    expect(note({ retainedSkills: skills, retainedSpec: {} })).toEqual(expected);
  });
});

interface Lists {
  retainedSkills: readonly string[];
  retainedImages?: readonly string[];
}

type KeptBindings = [
  p: readonly Message[],
  b: number,
  L: Lists,
  ee: string,
  se: (text: string) => string,
  Xe: () => string,
  c: undefined,
  du: (text: string) => number,
];

const runKept = payloadFunction<KeptBindings, Lists>(
  ['p', 'b', 'L', 'ee', 'se', 'Xe', 'c', 'du'],
  `${patchNamed(skillCarryPatches, 'compaction-leaves-out-skills-typed-in-kept-messages').replace};return L`,
);

function stored(messages: readonly Message[], keptFrom: number, list: readonly string[]): Lists {
  return runKept(
    messages,
    keptFrom,
    { retainedSkills: list, retainedImages: ['image'] },
    'summary',
    (text) => text,
    () => '',
    undefined,
    () => 0,
  );
}

describe('an automatic compaction that keeps the newest messages', () => {
  const older = [user('old work'), user('more old work')];

  test('a skill typed in a kept message is left out, text and name, because the message still shows it', () => {
    const messages = [...older, typed('rhyme', RHYME)];
    const list = retained({ messages, loaded: ['rhyme', 'reviewing'] });
    expect(list).toEqual([RHYME_UNIT, 'reviewing', 'rhyme']);
    expect(stored(messages, 2, list)).toEqual({
      retainedSkills: ['reviewing'],
      retainedImages: ['image'],
    });
  });

  test('a skill typed in a message the compaction removes stays carried', () => {
    const messages = [typed('rhyme', RHYME), ...older];
    const list = retained({ messages, loaded: ['rhyme'] });
    expect(stored(messages, 1, list).retainedSkills).toEqual(list);
  });

  test('a carried skill typed again in a kept message is left to that message', () => {
    const messages = [...older, typed('rhyme', PROSE)];
    const list = retained({ messages, previous: [RHYME_UNIT, PROSE_UNIT, 'prose', 'rhyme'] });
    expect(stored(messages, 2, list).retainedSkills).toEqual([PROSE_UNIT, 'prose']);
  });

  test('with nothing typed in the kept messages the lists are stored as they are', () => {
    const lists = stored([...older, user('recent')], 2, [RHYME_UNIT, 'rhyme']);
    expect(lists.retainedSkills).toEqual([RHYME_UNIT, 'rhyme']);
  });

  test('the next compaction, once it removes that message, carries the skill again', () => {
    const messages = [...older, typed('rhyme', RHYME)];
    const kept = stored(messages, 2, retained({ messages, loaded: ['rhyme'] }));
    expect(
      retained({
        messages: [typed('rhyme', RHYME)],
        previous: kept.retainedSkills,
        loaded: ['rhyme'],
      }),
    ).toEqual([RHYME_UNIT, 'rhyme']);
  });
});
const STOCK_NOTICE =
  /return`(?<template>\$\{[\w$]+\}\nSkills provide[^`]*?\n<\/skill>\n\$\{[\w$]+\})/u;

function filled(template: string, values: readonly string[]): string {
  const holes: string[] = [];
  return template.replaceAll(/\$\{(?<hole>[\w$]+)\}/gu, (_match, hole: string) => {
    if (!holes.includes(hole)) {
      holes.push(hole);
    }
    return values[holes.indexOf(hole)] ?? '';
  });
}

const { patchedText, rebasedNamed } = shipped(skillCarryPatches);

describe.skipIf(stock === undefined)('the shipped source', () => {
  test.each(skillCarryPatches.map((patch) => [patch.name] as const))('%s lands once', (name) => {
    const { find, replace } = rebasedNamed(name);
    expect(occurrences(stockText, find)).toBe(1);
    expect(occurrences(stockText, replace)).toBe(0);
    expect(occurrences(patchedText, replace)).toBe(1);
  });

  test('the notice Droid writes for a typed skill is the one the payload carries', () => {
    const template = STOCK_NOTICE.exec(stockText)?.groups?.['template'] ?? '';
    const written = filled(template, [
      OPEN,
      'rhyme',
      '/home/me/.agents/skills/rhyme/SKILL.md',
      'A fixture skill',
      'personal',
      RHYME,
      CLOSE,
    ]);
    expect(written).toBe(typedNotice('rhyme', RHYME));
    expect(retained({ messages: [user(`${written}\n\nplease start`)], loaded: ['rhyme'] })).toEqual(
      [RHYME_UNIT, 'rhyme'],
    );
    expect(stockText).toContain(`="${OPEN}"`);
    expect(stockText).toContain(`="${CLOSE}"`);
  });

  test('the stock spec rendering is preserved once before skill text across compactions', () => {
    const { find, replace } = rebasedNamed('compaction-note-shows-typed-skill-text');
    const source = stock?.find((module) => module.text.includes(find))?.text ?? '';
    const name = declarationAround(source, source.indexOf(find));
    const render = (text: string) =>
      payloadFunction<[], (previous: Previous) => string>(
        [],
        `${closureOf(text, [name])};return ${name}`,
      )();
    const original = render(source);
    const patched = render(source.replace(find, replace));
    for (const spec of [
      undefined,
      null,
      { path: '/tmp/approved\nspec.md', comment: 'Address this comment.' },
      { plan: 'Keep the exact\napproved plan.', comment: 'Do not omit this.' },
    ]) {
      const previous = spec === undefined ? {} : { retainedSpec: spec };
      const expectedSpec = original(previous);
      const untyped = original({ retainedSkills: ['reviewing'] });
      let list = retained({ messages: [typed('rhyme', RHYME)], loaded: ['rhyme', 'reviewing'] });
      for (let turn = 0; turn < 3; turn += 1) {
        expect(patched({ ...previous, retainedSkills: list })).toBe(
          [expectedSpec, RHYME_UNIT, untyped].filter(Boolean).join('\n\n'),
        );
        list = retained({ messages: [summaryMessage(list)], previous: list });
      }
    }
  });
});
