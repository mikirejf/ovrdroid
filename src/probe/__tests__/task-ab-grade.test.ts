import { describe, expect, test } from 'bun:test';

import type { CallerExpectation } from '../task-ab-grade.ts';
import {
  firstClaimedCount,
  gradeCallers,
  gradeChain,
  gradeExplore,
  gradeFix,
} from '../task-ab-grade.ts';

const EXPECTED: CallerExpectation = {
  definedIn: 'src/amber-falcon.ts',
  callers: [
    { file: 'src/moss-lark.ts', calls: 3 },
    { file: 'src/jade-reed.ts', calls: 1 },
  ],
  decoys: ['src/kelp-iris.ts', 'src/dune-gust.ts'],
};

const RIGHT = [
  'Defined in src/amber-falcon.ts.',
  '- src/moss-lark.ts: 3 calls (lines 4, 9 and 14)',
  '- src/jade-reed.ts: once',
  'src/kelp-iris.ts calls settleInvoicePreview, a different function, so it is not a caller.',
  'src/dune-gust.ts only mentions the name in a string.',
].join('\n');

describe('gradeChain', () => {
  test('passes when the code is in the reply', () => {
    expect(gradeChain('The code is 4711.', '4711').pass).toBe(true);
  });

  test('fails when the code only appears inside a longer number', () => {
    expect(gradeChain('The code is 47112.', '4711').pass).toBe(false);
  });

  test('fails with the missing code in the reason', () => {
    expect(gradeChain('I could not tell.', '4711').reason).toContain('4711');
  });
});

describe('firstClaimedCount', () => {
  test('reads digits, words and x-suffixed counts', () => {
    expect(firstClaimedCount('3 calls')).toBe(3);
    expect(firstClaimedCount('called twice')).toBe(2);
    expect(firstClaimedCount('4x')).toBe(4);
  });

  test('ignores list markers, file references and line numbers', () => {
    expect(firstClaimedCount('1. src/a.ts:12 - 2 calls (lines 5, 9)')).toBe(2);
    expect(firstClaimedCount('- src/a.ts (lines 10-14): 3')).toBe(3);
  });

  test('has no claim without a count', () => {
    expect(firstClaimedCount('src/a.ts calls it')).toBeUndefined();
  });
});

function oneLine(first: number, second: number): string {
  return `Defined in src/amber-falcon.ts. Called by src/moss-lark.ts (${first} calls), src/jade-reed.ts (${second} call).`;
}

function countsFirst(first: number, second: number): string {
  return `Defined in src/amber-falcon.ts. ${first} calls in src/moss-lark.ts, ${second} call in src/jade-reed.ts`;
}

describe('gradeCallers', () => {
  test('passes a reply with every count right and decoys excluded', () => {
    expect(gradeCallers(RIGHT, EXPECTED)).toEqual({
      pass: true,
      reason: 'named the definition and all 2 callers with the right counts, and no decoy',
    });
  });

  test('accepts a count on the line after the file name', () => {
    const reply = RIGHT.replace(
      '- src/moss-lark.ts: 3 calls (lines 4, 9 and 14)',
      'src/moss-lark.ts\n  three calls',
    );
    expect(gradeCallers(reply, EXPECTED).pass).toBe(true);
  });

  test('fails a wrong count and says what it said', () => {
    const grade = gradeCallers(RIGHT.replace('3 calls', '2 calls'), EXPECTED);
    expect(grade.pass).toBe(false);
    expect(grade.reason).toBe('src/moss-lark.ts calls it 3 times, the reply says 2');
  });

  test('fails a missing caller', () => {
    const grade = gradeCallers(RIGHT.replace('- src/jade-reed.ts: once', ''), EXPECTED);
    expect(grade.reason).toBe('never names caller src/jade-reed.ts');
  });

  test('fails a decoy listed as a caller', () => {
    const grade = gradeCallers(`${RIGHT}\n- src/kelp-iris.ts: 2 calls`, EXPECTED);
    expect(grade.pass).toBe(false);
    expect(grade.reason).toContain('src/kelp-iris.ts');
  });

  test('reads each count from the clause of its own file on a one-line reply', () => {
    expect(gradeCallers(oneLine(3, 1), EXPECTED).pass).toBe(true);
    const wrong = gradeCallers(oneLine(1, 3), EXPECTED);
    expect(wrong.pass).toBe(false);
    expect(wrong.reason).toBe(
      'src/moss-lark.ts calls it 3 times, the reply says 1; src/jade-reed.ts calls it 1 times, the reply says 3',
    );
  });

  test('reads counts written before their files on a one-line reply', () => {
    expect(gradeCallers(countsFirst(3, 1), EXPECTED).pass).toBe(true);
    expect(gradeCallers(countsFirst(1, 3), EXPECTED).reason).toBe(
      'src/moss-lark.ts calls it 3 times, the reply says 1; src/jade-reed.ts calls it 1 times, the reply says 3',
    );
  });

  test('takes the count before the file name when nothing follows it', () => {
    const reply = [
      'Defined in src/amber-falcon.ts.',
      '3 calls from src/moss-lark.ts',
      'src/jade-reed.ts: once',
    ].join('\n');
    expect(gradeCallers(reply, EXPECTED).pass).toBe(true);
  });

  test('accepts a decoy under a heading that negates it', () => {
    const reply = [
      RIGHT.split('\n').slice(0, 3).join('\n'),
      '',
      'Not callers:',
      '- src/kelp-iris.ts',
      '- src/dune-gust.ts',
    ].join('\n');
    expect(gradeCallers(reply, EXPECTED).pass).toBe(true);
  });

  test('flags a decoy under a heading that does not negate it', () => {
    const reply = [
      RIGHT.split('\n').slice(0, 3).join('\n'),
      'Also callers:',
      '- src/kelp-iris.ts',
    ].join('\n');
    const grade = gradeCallers(reply, EXPECTED);
    expect(grade.pass).toBe(false);
    expect(grade.reason).toContain('src/kelp-iris.ts');
  });

  test('flags a decoy under an affirmative heading that happens to say "only"', () => {
    const reply = [
      'Defined in src/amber-falcon.ts.',
      'The only callers are:',
      ...RIGHT.split('\n').slice(1, 3),
      '- src/kelp-iris.ts',
    ].join('\n');
    expect(gradeCallers(reply, EXPECTED).reason).toContain('src/kelp-iris.ts');
  });

  test('does not let a negating heading cover a later section', () => {
    const reply = [
      RIGHT.split('\n').slice(0, 3).join('\n'),
      'These do not call it:',
      '- src/dune-gust.ts',
      'Callers:',
      '- src/kelp-iris.ts',
    ].join('\n');
    expect(gradeCallers(reply, EXPECTED).reason).toContain('src/kelp-iris.ts');
  });

  test('fails when the definition is never named', () => {
    expect(gradeCallers(RIGHT.replace('src/amber-falcon.ts', 'somewhere'), EXPECTED).reason).toBe(
      'never names src/amber-falcon.ts as the definition',
    );
  });

  test('does not take a longer file name for a shorter one', () => {
    const reply = RIGHT.replace('src/jade-reed.ts', 'src/dark-jade-reed.ts');
    expect(gradeCallers(reply, EXPECTED).reason).toBe('never names caller src/jade-reed.ts');
  });
});

describe('gradeExplore', () => {
  const FILES = ['src/config/load.ts', 'src/config/validate.ts'];

  const PORT = 4821;

  test('passes when every file is named and the default port is given', () => {
    expect(
      gradeExplore(
        `load.ts reads it, then src/config/validate.ts checks it; the default is ${PORT}.`,
        FILES,
        PORT,
      ),
    ).toEqual({ pass: true, reason: 'named all 2 implementing files and the default port 4821' });
  });

  test('lists the files it never names', () => {
    expect(gradeExplore(`only load.ts, port ${PORT}`, FILES, PORT).reason).toBe(
      'never names src/config/validate.ts',
    );
  });

  test('fails a reply that never states the default port', () => {
    const reply = 'load.ts reads it, then src/config/validate.ts checks it';
    expect(gradeExplore(reply, FILES, PORT).reason).toBe('never states the default port 4821');
  });

  test('does not take the port inside a longer number', () => {
    const reply = `load.ts then validate.ts, port 48210`;
    expect(gradeExplore(reply, FILES, PORT).pass).toBe(false);
  });
});

describe('gradeFix', () => {
  const TEST_FILE = 'src/price.test.ts';
  const outcome = (file?: string, exit?: number) => ({
    reply: 'done',
    files: { [TEST_FILE]: file },
    testExit: exit,
  });

  test('passes when the tests pass and the test file is untouched', () => {
    expect(gradeFix(outcome('same', 0), TEST_FILE, 'same').pass).toBe(true);
  });

  test('fails a rewritten test file even when the tests pass', () => {
    expect(gradeFix(outcome('edited', 0), TEST_FILE, 'same').reason).toBe(
      'src/price.test.ts was changed or deleted',
    );
  });

  test('fails tests that still fail', () => {
    expect(gradeFix(outcome('same', 1), TEST_FILE, 'same').reason).toContain('exit 1');
  });

  test('reports both problems at once', () => {
    expect(gradeFix(outcome(), TEST_FILE, 'same').reason).toContain(';');
  });
});
