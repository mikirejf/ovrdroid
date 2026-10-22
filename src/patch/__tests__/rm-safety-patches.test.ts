import { describe, expect, test } from 'bun:test';

import type { Patch } from '../patches.ts';
import { HARD_BLOCK_STOCK, rmSafetyPatches } from '../rm-safety-patches.ts';
import { describeStrayNames, occurrences, patchNamed, payloadFunction } from './payload.ts';

const BRACED_HOME = ['$', '{HOME}'].join('');
const HOME_DIRECTORY = '/Users/me';
const BACKTICK = '`';
const TEMPLATE_HOME_GLOB = [BACKTICK, '$', '{o}/*', BACKTICK].join('');
const NEWLINE_LITERAL = [BACKTICK, '\n', BACKTICK].join('');

function patched(stock: string, patch: Patch): string {
  expect(occurrences(stock, patch.find)).toBe(1);
  return stock.replace(patch.find, () => patch.replace);
}

describeStrayNames(rmSafetyPatches);

const STOCK_HARD_BLOCKS = String.raw`[/^rm\s+-rf\s+\/\s*$/,/^rm\s+-rf\s+\/\*/,/^rm\s+-rf\s+~\s*$/,${HARD_BLOCK_STOCK}/:\(\)\{\s*:\|\s*:\s*&\s*\};/,/>\s*\/dev\/sda/,/dd\s+if=\/dev\/zero\s+of=\/dev/]`;

function hardBlocks(list: string): RegExp[] {
  return payloadFunction<[], RegExp[]>([], `return ${list}`)();
}

const stockBlocks = hardBlocks(STOCK_HARD_BLOCKS);
const wholeTargetBlocks = hardBlocks(
  patched(STOCK_HARD_BLOCKS, patchNamed(rmSafetyPatches, 'rm-hard-block-whole-home-target')),
);

function blocked(command: string): boolean {
  return wholeTargetBlocks.some((pattern) => pattern.test(command.trim()));
}

describe('the Execute hard block list stops only a whole root or home target', () => {
  test('every other entry is untouched', () => {
    expect(wholeTargetBlocks).toHaveLength(stockBlocks.length);
    for (const index of [0, 1, 2, 5, 6, 7]) {
      expect(wholeTargetBlocks[index]?.source).toBe(stockBlocks[index]?.source);
    }
  });

  test.each([
    'rm -rf /',
    'rm -rf /*',
    'rm -rf ~',
    'rm -rf ~/',
    'rm -rf ~/*',
    'rm -rf  ~/*  ',
    'rm -rf ~/;ls',
    'rm -rf ~/ /tmp/x',
    'rm -rf $HOME',
    'rm -rf $HOME/',
    'rm -rf $HOME/*',
    'rm -rf $HOME /tmp/x',
    'rm -rf $HOME;ls',
    'rm -rf $HOME && ls',
  ])('%s is blocked', (command) => {
    expect(blocked(command)).toBe(true);
  });

  test.each([
    'rm -rf ~/x',
    'rm -rf ~/.cache/x',
    'rm -rf $HOME/x',
    'rm -rf $HOME/.cache/x',
    'rm -rf ~/*.log',
    'rm -rf $HOMEBREW',
    'rm -rf ./build',
  ])('%s runs', (command) => {
    expect(blocked(command)).toBe(false);
  });

  test('stock blocked a harmless path under home', () => {
    expect(stockBlocks.some((pattern) => pattern.test('rm -rf ~/x'))).toBe(true);
    expect(stockBlocks.some((pattern) => pattern.test('rm -rf $HOME/x'))).toBe(true);
  });
});

const STOCK_GUARD = String.raw`function P(e){return no(e,Le)?void 0:Zt(e)}function xe(e,n,i){let t=n.homeDirectory?.replace(/\/+$/,""),o=t?.startsWith("/")?t:void 0;if(o&&i&&["~","~/","~/*"].includes(e))return!0;if(e==="/*")return!0;if(o&&e===${TEMPLATE_HOME_GLOB}&&P(o)===o)return!0;let r=P(e);return r!==void 0&&(/^\/+$/.test(r)||o!==void 0&&r.replace(/\/+$/,"")===o)}function V(e,n,i){let t=!1,o=!1;for(let r of e){let l=P(r);if(!t&&l==="--"){t=!0;continue}let c=xe(r,n,i);if(!t&&(l===void 0&&!c||l?.startsWith("-")))return!1;o||=c}return o}function Ee({rawArgs:e,homeExpansionIsKnown:n},i){if(!e)return!1;let t=!1,o=!1,r=[];for(let l of e){let c=P(l);if(!o&&c==="--")o=!0;else if(!o&&c?.startsWith("-")){if(r.length>0&&i.platform!=="linux")return!1;if(/^-[rRf]+$/.test(c))t||=/[rR]/.test(c);else if(i.platform==="linux"&&["--recursive","--force","--no-preserve-root"].includes(c))t||=c==="--recursive";else return!1;continue}r.push(l)}return t&&V(r,i,n)}function T(e,n){if(n==="linux")return/^\/dev\/(?:(?:sd|vd|xvd)[a-z]+(?:[1-9][0-9]*)?|nvme[0-9]+n[0-9]+(?:p[1-9][0-9]*)?|mmcblk[0-9]+(?:p[1-9][0-9]*)?)$/.test(e);return n==="darwin"&&/^\/dev\/r?disk[0-9]+(?:s[0-9]+)*$/.test(e)}`;

interface Invocation {
  rawArgs: string[];
  homeExpansionIsKnown: boolean;
}

type Guard = (
  invocation: Invocation,
  context: { platform: string; homeDirectory: string },
) => boolean;

function guardOf(source: string): Guard {
  return payloadFunction<[], Guard>(
    [],
    `const no=(word)=>/[$\`*?]/.test(word),Le=0,Zt=(word)=>word.replaceAll(/["']/g,"");${source}return Ee`,
  )();
}

const stockGuard = guardOf(STOCK_GUARD);
const homeGuard = guardOf(
  patched(STOCK_GUARD, patchNamed(rmSafetyPatches, 'rm-protected-target-any-home-spelling')),
);

function asks(guard: Guard, command: string, known = true): boolean {
  const [, ...rawArgs] = command.split(' ');
  return guard(
    { rawArgs, homeExpansionIsKnown: known },
    { platform: 'darwin', homeDirectory: HOME_DIRECTORY },
  );
}

const UNPARSED_FLAG_COMMANDS = [
  'rm -rfv ~',
  'rm -rfi "$HOME"',
  'rm -r -v ~',
  'rm -rf ~ -v',
  `rm -Rf ${BRACED_HOME}/`,
  'rm --recursive ~',
  'rm -rf -v "$HOME"',
];

describe('rm-protected-target asks for every spelling of home', () => {
  test.each([
    'rm -rf ~',
    'rm -rf ~/',
    'rm -rf ~/*',
    'rm -rf $HOME',
    'rm -rf $HOME/',
    'rm -rf $HOME/*',
    'rm -rf $HOME//',
    `rm -rf ${BRACED_HOME}`,
    `rm -rf ${BRACED_HOME}/`,
    `rm -rf ${BRACED_HOME}/*`,
    'rm -rf "$HOME"',
    'rm -rf "$HOME"/',
    'rm -rf "$HOME"/*',
    'rm -rf "$HOME/"',
    `rm -rf "${BRACED_HOME}"`,
    `rm -rf "${BRACED_HOME}"/*`,
    'rm -r -f $HOME',
    'rm -fR $HOME',
    'rm -rf $HOME /tmp/x',
    'rm -rf /tmp/x $HOME',
    'rm -rf "$HOME" "$ELSEWHERE"',
    'rm -rf -- $HOME',
  ])('%s asks', (command) => {
    expect(asks(homeGuard, command)).toBe(true);
  });

  test.each(UNPARSED_FLAG_COMMANDS)('%s asks although stock cannot read its flags', (command) => {
    expect(asks(homeGuard, command)).toBe(true);
    expect(asks(stockGuard, command)).toBe(false);
  });

  test.each(['rm -rf ~', 'rm -rf ~/*', 'rm -rf "$HOME"/*', `rm -rf ${BRACED_HOME}`])(
    '%s asks when the command has several segments',
    (command) => {
      expect(asks(homeGuard, command, false)).toBe(true);
    },
  );

  test.each([
    'rm -rf ~/.cache/x',
    'rm -rf $HOME/x',
    'rm -rf $HOME/.cache/x',
    'rm -rf "$HOME"/.cache/x',
    'rm -rf "$HOME/.cache/x"',
    `rm -rf ${BRACED_HOME}/x`,
    `rm -rf "${BRACED_HOME}"/x`,
    'rm -rf $HOMEBREW',
    `rm -rf ${['$', '{HOMEDIR}'].join('')}`,
    'rm -rf ~user',
    'rm -rf ./build',
    'rm -rf /tmp/x',
    'rm -f $HOME',
    'rm $HOME',
    'rm -v ~',
    'rm -rfv ~/x',
    'rm -rfv "$HOME"/x',
    'rm --recursive ~/x',
  ])('%s runs', (command) => {
    expect(asks(homeGuard, command)).toBe(false);
  });

  test('stock lets the quoted and braced spellings run', () => {
    expect(asks(stockGuard, 'rm -rf "$HOME"')).toBe(false);
    expect(asks(stockGuard, 'rm -rf $HOME')).toBe(false);
    expect(asks(stockGuard, 'rm -rf ~', false)).toBe(false);
  });

  test('stock still asks for the bare tilde of a single-segment command', () => {
    expect(asks(stockGuard, 'rm -rf ~')).toBe(true);
    expect(asks(homeGuard, 'rm -rf ~')).toBe(true);
  });
});

const STOCK_SCREEN = String.raw`function Ve(e){let t="",n=!1,r=!1;for(let i=0;i<e.length;i++){let s=e[i];if(s==="\\")return!1;if(t){if(s===t)t=""}else if(s==="'"||s==='"')t=s,n=!0;else if(/[(){}<>\r]/.test(s)||s==="#"&&(i===0||/[ \t\n;&|]/.test(e[i-1]))||/\s/.test(s)&&![" ","\t",${NEWLINE_LITERAL}].includes(s))return!1;else if(/[;&|]/.test(s)){if(!n)return!1;let o=e[i+1]===s;if(s==="&"&&!o)return!1;if(s!==";"&&o)i++;n=!1,r=s!==";"}else if(s===${NEWLINE_LITERAL}){if(n)r=!1;n=!1}else if(s!==" "&&s!=="\t")n=!0}if(t||r&&!n)return!1;return cd(e,!1).every((i)=>{let s=lT(i)[0]??"";return!no(s)&&!Qe.has(Zt(s))&&!/^[A-Za-z_][A-Za-z0-9_]*=/.test(s)})}`;

function screenOf(source: string): (command: string) => boolean {
  return payloadFunction<[], (command: string) => boolean>(
    [],
    `const cd=(text)=>text.split(/[;&|]+/),lT=(text)=>text.trim().split(/\\s+/),no=(word)=>word.includes("$"),Qe=new Set(["eval"]),Zt=(word)=>word;${source}return Ve`,
  )();
}

const stockScreen = screenOf(STOCK_SCREEN);
const bracedScreen = screenOf(
  patched(STOCK_SCREEN, patchNamed(rmSafetyPatches, 'rm-protected-target-braced-home-parses')),
);

describe('a braced home reaches the runtime safeguards', () => {
  test.each([
    `rm -rf ${BRACED_HOME}`,
    `rm -rf ${BRACED_HOME}/*`,
    `false && rm -rf ${BRACED_HOME}`,
    `rm -rf ${BRACED_HOME}/x`,
    'rm -rf ~',
  ])('%s is screened in', (command) => {
    expect(bracedScreen(command)).toBe(true);
  });

  test.each([
    'rm -rf {a,b}',
    `rm -rf ${['$', '{HOME'].join('')}`,
    `rm -rf ${['$', '{HOME:-/}'].join('')}`,
    'rm -rf $(echo x)',
    'rm -rf <(x)',
  ])('%s stays out', (command) => {
    expect(bracedScreen(command)).toBe(false);
  });

  test('stock screened a braced home out', () => {
    expect(stockScreen(`rm -rf ${BRACED_HOME}`)).toBe(false);
    expect(stockScreen('rm -rf ~')).toBe(true);
  });
});
