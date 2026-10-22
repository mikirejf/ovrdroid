import { describe, expect, test } from 'bun:test';

import { COMMAND_WORD_END } from '../denylist-patches.ts';

function commandWordEnd(): string {
  // SAFETY: the payload is the string literal the shipped pattern builder appends after a command word ending in a word character.
  // oxlint-disable-next-line no-new-func, typescript/no-implied-eval, typescript/no-unsafe-type-assertion
  return (new Function(`return ${COMMAND_WORD_END}`) as () => string)();
}

function deniesByWord(entry: string, command: string): boolean {
  const [word = '', argument = ''] = entry.split(' ');
  return new RegExp(
    `^${word}${commandWordEnd()}[^;&|]{0,100}${argument}([\\s;&|)\`]+|$)`,
    'iu',
  ).test(command);
}

describe('a deny entry only matches its command as a whole word', () => {
  test.each(['init 6', 'init  6', 'INIT 6', 'init 6;ls', 'init 6)'])('%s asks', (command) => {
    expect(deniesByWord('init 6', command)).toBe(true);
  });

  test.each(['init.BS957yFf.js:276', 'init-6', 'init.sh 6', 'initial 6'])(
    '%s passes',
    (command) => {
      expect(deniesByWord('init 6', command)).toBe(false);
    },
  );
});
