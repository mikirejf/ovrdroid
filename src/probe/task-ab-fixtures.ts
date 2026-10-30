import type { Grade, Outcome } from './task-ab-grade.ts';
import { gradeCallers, gradeChain, gradeExplore, gradeFix } from './task-ab-grade.ts';
import type { Rng } from './task-ab-rng.ts';
import { createRng } from './task-ab-rng.ts';
import type { Files } from './task-ab-sources.ts';
import { EXPLORE_FILES, exploreFeature, FIX_FILES, FIX_TEST_FILE } from './task-ab-sources.ts';

export const TASK_NAMES = ['chain', 'callers', 'explore', 'fix'] as const;

export type TaskName = (typeof TASK_NAMES)[number];

export interface Task {
  name: TaskName;
  prompt: string;
  autonomy: readonly string[];
  files: Readonly<Files>;
  watch: readonly string[];
  runTests: boolean;
  grade: (outcome: Outcome) => Grade;
}

const CHAIN_LENGTH = 30;
const CODE_FLOOR = 1000;
const CODE_SPAN = 9000;
const CALLER_COUNTS = [1, 2, 3, 4, 5];
const CALLER_FILES = 3;
const DECOY_CALLS = 3;
const FILLER_LIBS = 9;
const FILLER_COMMANDS = 5;
const FILLER_CALLERS = 6;
const ARGUMENT_FLOOR = 100;
const ARGUMENT_SPAN = 900;
const PORT_FLOOR = 2000;
const PORT_SPAN = 6000;
const AUTONOMY: readonly string[] = ['--auto', 'medium'];

const WORDS = [
  'amber',
  'birch',
  'cedar',
  'dune',
  'ember',
  'fjord',
  'glade',
  'harbor',
  'iris',
  'juniper',
  'kelp',
  'lichen',
  'maple',
  'nectar',
  'onyx',
  'pebble',
  'quartz',
  'reed',
  'sage',
  'tundra',
  'umber',
  'violet',
  'willow',
  'yarrow',
  'zephyr',
  'acorn',
  'basil',
  'clover',
  'dahlia',
  'fennel',
  'garnet',
  'heron',
  'indigo',
  'jasper',
  'kestrel',
  'lagoon',
  'marsh',
  'nimbus',
  'orchid',
  'plover',
  'quill',
  'raven',
  'saffron',
  'thistle',
  'vesper',
  'walnut',
  'yucca',
  'zinnia',
  'alder',
  'bramble',
  'coral',
  'drift',
  'falcon',
  'gust',
  'hazel',
  'jade',
  'lark',
  'moss',
];

const TARGETS = [
  'settleInvoice',
  'reserveStock',
  'archiveOrder',
  'refreshQuote',
  'mergeLedger',
  'rotateToken',
];

function uniqueNames(rng: Rng, count: number): () => string {
  const names = new Set<string>();
  while (names.size < count) {
    names.add(`${rng.pick(WORDS)}-${rng.pick(WORDS)}`);
  }
  const queue = [...names];
  return () => {
    const name = queue.pop();
    if (name === undefined) {
      throw new Error('the fixture asked for more file names than it reserved');
    }
    return name;
  };
}

function camel(name: string): string {
  return name
    .split('-')
    .map((part, at) => (at === 0 ? part : `${part.slice(0, 1).toUpperCase()}${part.slice(1)}`))
    .join('');
}

function fillerModule(name: string, rng: Rng): string {
  return [
    `export function ${camel(name)}(values: readonly number[]): number {`,
    `  return values.reduce((sum, value) => sum + value, ${rng.int(ARGUMENT_SPAN)});`,
    '}',
    '',
  ].join('\n');
}

function chainTask(rng: Rng): Task {
  const takeName = uniqueNames(rng, CHAIN_LENGTH);
  const names = Array.from({ length: CHAIN_LENGTH }, () => `${takeName()}.txt`);
  const code = String(CODE_FLOOR + rng.int(CODE_SPAN));
  const files: Files = {};
  for (const [at, name] of names.entries()) {
    const following = names[at + 1];
    files[name] = following === undefined ? `code: ${code}\n` : `next: ${following}\n`;
  }
  files['start.txt'] = `next: ${names[0] ?? ''}\n`;
  return {
    name: 'chain',
    prompt:
      'Start with start.txt in this folder. Each file names the next file to open. Follow the chain to its end and tell me the code written in the last file.',
    autonomy: [],
    files,
    watch: [],
    runTests: false,
    grade: ({ reply }) => gradeChain(reply, code),
  };
}

interface CallerSpec {
  target: string;
  definedIn: string;
  calls: number;
}

function callerModule({ target, definedIn, calls }: CallerSpec, rng: Rng): string {
  const lines = [`import { ${target} } from './${definedIn}.ts';`, ''];
  for (let at = 1; at <= calls; at++) {
    const argument = ARGUMENT_FLOOR + rng.int(ARGUMENT_SPAN);
    lines.push(
      `export function step${at}(): string {`,
      `  return ${target}(${argument}, '${rng.pick(WORDS)}');`,
      '}',
      '',
    );
  }
  return lines.join('\n');
}

function callersTask(rng: Rng): Task {
  const target = rng.pick(TARGETS);
  const takeName = uniqueNames(rng, 4 + CALLER_FILES + FILLER_CALLERS);
  const definedIn = takeName();
  const previewIn = takeName();
  const previewCaller = takeName();
  const stringMention = takeName();
  const callers = rng
    .sample(CALLER_COUNTS, CALLER_FILES)
    .map((calls) => ({ file: `src/${takeName()}.ts`, calls }));
  const files = {
    [`src/${definedIn}.ts`]: [
      `export function ${target}(amount: number, label: string): string {`,
      "  return [label, amount].join(':');",
      '}',
      '',
    ].join('\n'),
    [`src/${previewIn}.ts`]: [
      `export function ${target}Preview(amount: number): string {`,
      '  return String(amount);',
      '}',
      '',
    ].join('\n'),
    [`src/${previewCaller}.ts`]: [
      `import { ${target}Preview } from './${previewIn}.ts';`,
      '',
      ...Array.from({ length: DECOY_CALLS }, (_, at) =>
        [
          `export function look${at + 1}(): string {`,
          `  return ${target}Preview(${ARGUMENT_FLOOR + rng.int(ARGUMENT_SPAN)});`,
          '}',
          '',
        ].join('\n'),
      ),
    ].join('\n'),
    [`src/${stringMention}.ts`]: `export const AUDITED_NAMES: readonly string[] = ['${target}', '${rng.pick(WORDS)}'];\n`,
    ...Object.fromEntries(
      callers.map(({ file, calls }) => [file, callerModule({ target, definedIn, calls }, rng)]),
    ),
    ...Object.fromEntries(
      Array.from({ length: FILLER_CALLERS }, () => {
        const name = takeName();
        return [`src/${name}.ts`, fillerModule(name, rng)];
      }),
    ),
  };
  const expected = {
    definedIn: `src/${definedIn}.ts`,
    callers,
    decoys: [`src/${previewCaller}.ts`, `src/${stringMention}.ts`],
  };
  return {
    name: 'callers',
    prompt: `Find where the function \`${target}\` is defined in this project. Then list every other file that calls it, and say how many times each one calls it.`,
    autonomy: [],
    files,
    watch: [],
    runTests: false,
    grade: ({ reply }) => gradeCallers(reply, expected),
  };
}

function exploreTask(rng: Rng): Task {
  const takeName = uniqueNames(rng, FILLER_LIBS + FILLER_COMMANDS);
  const folders = [
    ...Array.from({ length: FILLER_LIBS }, () => 'lib'),
    ...Array.from({ length: FILLER_COMMANDS }, () => 'commands'),
  ];
  const port = PORT_FLOOR + rng.int(PORT_SPAN);
  const files = {
    ...exploreFeature(port),
    ...Object.fromEntries(
      folders.map((folder) => {
        const name = takeName();
        return [`src/${folder}/${name}.ts`, fillerModule(name, rng)];
      }),
    ),
  };
  return {
    name: 'explore',
    prompt:
      'In this project, how does the `serve` command decide which port it listens on? Explain the steps in order and name every source file that takes part.',
    autonomy: [],
    files,
    watch: [],
    runTests: false,
    grade: ({ reply }) => gradeExplore(reply, EXPLORE_FILES, port),
  };
}

function fixTask(): Task {
  return {
    name: 'fix',
    prompt:
      'The tests in this folder fail. Find out why, fix the code (not the tests), and run the tests to confirm they pass.',
    autonomy: AUTONOMY,
    files: FIX_FILES,
    watch: [FIX_TEST_FILE],
    runTests: true,
    grade: (outcome) => gradeFix(outcome, FIX_TEST_FILE, FIX_FILES[FIX_TEST_FILE]),
  };
}

export function buildTask(name: TaskName, seed: string): Task {
  const rng = createRng(seed);
  if (name === 'chain') {
    return chainTask(rng);
  }
  if (name === 'callers') {
    return callersTask(rng);
  }
  if (name === 'explore') {
    return exploreTask(rng);
  }
  return fixTask();
}
