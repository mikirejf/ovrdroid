import { describe, expect, test } from 'bun:test';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

const REPO = path.join(import.meta.dir, '..', '..', '..');
const SKILL = path.join(REPO, '.agents', 'skills', 'patching-droid-cli');
const HOW_TO_SHRINK = 'merge or cut bullets until it fits (UPDATING.md step 8)';

const LINE_BUDGETS = new Map([
  ['SKILL.md', 260],
  ['UPDATING.md', 150],
  ['UPDATING-DRIFT.md', 180],
  ['UPDATING-TESTS.md', 100],
  ['UPDATING-GATE.md', 90],
  ['MEASURING.md', 110],
  ['INSTRUMENTING.md', 100],
  ['MODULE-GRAPH.md', 70],
]);
const TOTAL_BUDGET = 1000;

function lineCount(text: string): number {
  return text.trimEnd().split('\n').length;
}

function codeTexts(markdown: string): string[] {
  const fenced = [...markdown.matchAll(/^```[^\n]*\n(?<body>[\s\S]*?)^```/gmu)].map(
    (match) => match.groups?.['body'] ?? '',
  );
  const prose = markdown.replaceAll(/^```[^\n]*\n[\s\S]*?^```/gmu, '');
  const spans = [...prose.matchAll(/`(?<code>[^`\n]+)`/gu)].map(
    (match) => match.groups?.['code'] ?? '',
  );
  return [...fenced, ...spans];
}

function repoPaths(markdown: string): string[] {
  return [...markdown.matchAll(/(?<![\w/.~-])src\/[\w./$-]*/gu)].map((match) =>
    match[0].replace(/[.,]+$/u, ''),
  );
}

function sourceFileNames(markdown: string): string[] {
  return codeTexts(markdown).filter((code) => /^[\w.-]+\.ts$/u.test(code));
}

function commandsNamed(markdown: string, program: string): string[] {
  const pattern = new RegExp(String.raw`(?:^|[\s(])${program} (?<command>[a-z][a-z-]*)`, 'gmu');
  return codeTexts(markdown).flatMap((code) =>
    [...code.matchAll(pattern)].map((match) => match.groups?.['command'] ?? ''),
  );
}

function headingSlug(heading: string): string {
  return heading
    .toLowerCase()
    .replaceAll('`', '')
    .replaceAll(/[^\w\s-]/gu, '')
    .trim()
    .replaceAll(/\s/gu, '-');
}

interface Link {
  file: string;
  anchor: string | undefined;
}

function localLinks(markdown: string): Link[] {
  return [...markdown.matchAll(/\]\((?<target>[^)\s]+)\)/gu)]
    .map((match) => match.groups?.['target'] ?? '')
    .filter((target) => !/^[a-z]+:/u.test(target))
    .map((target) => {
      const [file = '', anchor] = target.split('#');
      return { file, anchor };
    });
}

function anchorsOf(markdown: string): Set<string> {
  return new Set(
    [...markdown.matchAll(/^#+ (?<heading>.+)$/gmu)].map((match) =>
      headingSlug(match.groups?.['heading'] ?? ''),
    ),
  );
}

function helpCommands(script: string): Set<string> {
  const help = Bun.spawnSync(['bun', script, '--help'], { cwd: REPO });
  const lines = help.stdout.toString().split('\n');
  return new Set(
    lines.flatMap((line) => /^ {2}(?<command>[a-z][\w-]*)/u.exec(line)?.groups?.['command'] ?? []),
  );
}

function sourceBasenames(): Set<string> {
  const files = readdirSync(path.join(REPO, 'src'), { recursive: true, encoding: 'utf-8' });
  return new Set(files.map((file) => path.basename(file)));
}

const docs = readdirSync(SKILL)
  .filter((name) => name.endsWith('.md'))
  .map((name) => ({ name, text: readFileSync(path.join(SKILL, name), 'utf-8') }));

describe('reading a skill file', () => {
  const sample = [
    'Run `bun run probe grep $STOCK x` and `probe hub`, a probe that waits.',
    '```bash',
    'bun run ovrdroid apply --target /tmp/x   # then src/binary/ and work/src/<new>',
    '```',
    'See `src/patch/rebase.ts`, `stock-source.test.ts` and [steps](UPDATING.md#8-fold-in-it).',
  ].join('\n');

  test('finds the commands named in code only', () => {
    expect(commandsNamed(sample, 'probe')).toEqual(['grep', 'hub']);
    expect(commandsNamed(sample, 'ovrdroid')).toEqual(['apply']);
  });

  test('finds repo paths and skips paths that only end in src', () => {
    expect(repoPaths(sample)).toEqual(['src/binary/', 'src/patch/rebase.ts']);
  });

  test('finds bare source file names and local links', () => {
    expect(sourceFileNames(sample)).toEqual(['stock-source.test.ts']);
    expect(localLinks(sample)).toEqual([{ file: 'UPDATING.md', anchor: '8-fold-in-it' }]);
  });

  test('slugs a heading the way GitHub anchors it', () => {
    expect(headingSlug('8. Fold in what you learned')).toBe('8-fold-in-what-you-learned');
    expect(headingSlug('Is the patch still needed?')).toBe('is-the-patch-still-needed');
    expect(headingSlug('`no-lookup`')).toBe('no-lookup');
  });
});

describe('the patching-droid-cli skill', () => {
  test('every file stays within its line budget', () => {
    const problems = docs.flatMap(({ name, text }) => {
      const budget = LINE_BUDGETS.get(name);
      if (budget === undefined) {
        return [`${name} has no line budget: fit it inside the existing budgets or give it one`];
      }
      const lines = lineCount(text);
      return lines > budget
        ? [`${name} has ${lines} lines, budget ${budget}: ${HOW_TO_SHRINK}`]
        : [];
    });
    expect(problems).toEqual([]);
  });

  test('the skill as a whole stays within its total budget', () => {
    const total = docs.reduce((sum, { text }) => sum + lineCount(text), 0);
    const problems =
      total > TOTAL_BUDGET
        ? [`the skill has ${total} lines, budget ${TOTAL_BUDGET}: ${HOW_TO_SHRINK}`]
        : [];
    expect(problems).toEqual([]);
  });

  test('every repo path and source file a file names still exists', () => {
    const basenames = sourceBasenames();
    const problems = docs.flatMap(({ name, text }) => [
      ...repoPaths(text)
        .filter((named) => !existsSync(path.join(REPO, named)))
        .map((named) => `${name} names ${named}, which is gone: update or delete that line`),
      ...sourceFileNames(text)
        .filter((file) => !basenames.has(file))
        .map((file) => `${name} names ${file}, which is gone: update or delete that line`),
    ]);
    expect(problems).toEqual([]);
  });

  test('every probe and ovrdroid command a file names still exists', () => {
    const programs = [
      { program: 'probe', commands: helpCommands('src/probe/probe.ts') },
      { program: 'ovrdroid', commands: helpCommands('src/index.ts') },
    ];
    const problems = docs.flatMap(({ name, text }) =>
      programs.flatMap(({ program, commands }) =>
        commandsNamed(text, program)
          .filter((command) => !commands.has(command))
          .map((command) => `${name} names \`${program} ${command}\`, which is gone`),
      ),
    );
    expect(problems).toEqual([]);
  });

  test('every local link reaches its file and heading', () => {
    const problems = docs.flatMap(({ name, text }) =>
      localLinks(text).flatMap(({ file, anchor }) => {
        const target = file === '' ? path.join(SKILL, name) : path.join(SKILL, file);
        if (!existsSync(target)) {
          return [`${name} links to ${file}, which does not exist`];
        }
        if (anchor === undefined || !target.endsWith('.md')) {
          return [];
        }
        return anchorsOf(readFileSync(target, 'utf-8')).has(anchor)
          ? []
          : [`${name} links to ${file}#${anchor}, a heading that does not exist`];
      }),
    );
    expect(problems).toEqual([]);
  });
});
