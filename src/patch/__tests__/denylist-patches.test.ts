import { describe, expect, test } from 'bun:test';

import { denylistPatches } from '../denylist-patches.ts';

type Tail = (last: string, escaped: string) => string;

function replacementOf(name: string): string {
  const patch = denylistPatches.find((candidate) => candidate.name === name);
  if (patch === undefined) {
    throw new TypeError(`${name} is missing from the deny-list patches`);
  }
  return patch.replace;
}

const ROOT_OR_HOME = replacementOf('denylist-root-home-whole-argument');
const ABSOLUTE_PATH = replacementOf('denylist-absolute-path-whole-argument');

const STOCK_ARGUMENT_END = `let l=(c)=>c.includes("/")?"([\\\\s;&|)\`/]+|$)":"([\\\\s;&|)\`]+|$)";`;

function buildTail(): Tail {
  // SAFETY: the body is both patch payloads in the if/else-if chain the shipped
  // pattern builder puts them in, with `l` bound to the stock argument-end helper.
  // oxlint-disable-next-line no-new-func, typescript/no-implied-eval, typescript/no-unsafe-type-assertion, typescript/no-unsafe-call
  return new Function(
    `${STOCK_ARGUMENT_END}return function(s,u){let c=[];${ROOT_OR_HOME}else if(!1);${ABSOLUTE_PATH}return c.join("")}`,
  )() as Tail;
}

const tail = buildTail();

function denies(entry: string, command: string): boolean {
  const tokens = entry.split(' ');
  const [first = '', middle = '', last = ''] = tokens;
  const escaped = last.replaceAll(/[.*+?^${}()|[\]\\]/gu, String.raw`\$&`);
  const gap = last.startsWith('/') ? '[^;&|.]{0,100}' : '[^;&|]{0,100}';
  return new RegExp(`^${first}\\b${gap}${middle}${tail(last, escaped)}`, 'iu').test(command);
}

describe('rm -rf / only matches a bare root argument', () => {
  test.each([
    'rm -rf /',
    'rm -rf //',
    'rm -rf -- /',
    'rm -rf / ',
    'rm -rf /;ls',
    'rm -rf "/"',
    "rm -rf '/'",
    'rm -rf ./a /',
    'rm -rf /./*',
    'rm -rf /./',
    'rm -rf /.',
    'rm -rf /..',
    'rm -rf /*',
    'rm -rf /?*',
    'rm -rf /*?',
    "rm -rf '/'*",
  ])('%s asks', (command) => {
    expect(denies('rm -rf /', command)).toBe(true);
  });

  test.each([
    'rm -rf dev-tooling/cheat-extension',
    'rm -rf work/src/0.220.0',
    'rm -rf node_modules/.vite node_modules/.vitest',
    'rm -rf /var/folders/kh/tmp.r4dxjTMCFC',
    'rm -rf ./dist',
    'rm -rf /.git',
  ])('%s passes', (command) => {
    expect(denies('rm -rf /', command)).toBe(false);
  });
});

describe('rm -rf ~ only matches a bare home argument', () => {
  test.each([
    'rm -rf ~',
    'rm -rf ~/',
    'rm -rf ~ /tmp/x',
    'rm -rf ~/./*',
    'rm -rf ~/..',
    'rm -rf ~/?*',
  ])('%s asks', (command) => {
    expect(denies('rm -rf ~', command)).toBe(true);
  });

  test.each(['rm -rf ~/.cache/foo', 'rm -rf ~/.cache', 'rm -rf dir~backup'])(
    '%s passes',
    (command) => {
      expect(denies('rm -rf ~', command)).toBe(false);
    },
  );
});

const BRACED_HOME = ['$', '{HOME}'].join('');

describe('rm -rf $HOME only matches a bare home argument', () => {
  test.each([
    'rm -rf $HOME',
    'rm -rf $HOME/',
    'rm -rf $HOME/*',
    'rm -rf $HOME/?*',
    'rm -rf "$HOME"',
    'rm -rf "$HOME"/',
    'rm -rf "$HOME/"',
    'rm -rf "$HOME"/*',
    `rm -rf ${BRACED_HOME}`,
    `rm -rf ${BRACED_HOME}/`,
    `rm -rf "${BRACED_HOME}"/*`,
  ])('%s asks', (command) => {
    expect(denies('rm -rf $HOME', command)).toBe(true);
  });

  test.each(['rm -rf $HOME/x', 'rm -rf "$HOME/x"', `rm -rf ${BRACED_HOME}/x`, 'rm -rf $HOMEBREW'])(
    '%s passes',
    (command) => {
      expect(denies('rm -rf $HOME', command)).toBe(false);
    },
  );
});

describe('rm -rf /* only matches a bare root glob', () => {
  test('rm -rf /* asks', () => {
    expect(denies('rm -rf /*', 'rm -rf /*')).toBe(true);
  });

  test('rm -rf build/* passes', () => {
    expect(denies('rm -rf /*', 'rm -rf build/*')).toBe(false);
  });
});

const COMMAND_WORD_END = replacementOf('denylist-command-word-whole-argument');

function commandWordEnd(word: string): string {
  // SAFETY: the payload is one declarator of the shipped pattern builder's `let`, reading its entry tokens from `e`.
  // oxlint-disable-next-line no-new-func, typescript/no-implied-eval, typescript/no-unsafe-type-assertion
  return (new Function('e', `let ${COMMAND_WORD_END}return a`) as (tokens: string[]) => string)([
    word,
  ]);
}

function deniesByWord(entry: string, command: string): boolean {
  const [word = '', argument = ''] = entry.split(' ');
  return new RegExp(
    `^${word}${commandWordEnd(word)}[^;&|]{0,100}${argument}([\\s;&|)\`]+|$)`,
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
