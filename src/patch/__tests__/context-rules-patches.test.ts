import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test';
import * as fs from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import {
  ALWAYS_APPLY,
  contextRulesPatches,
  RULES_LOADER,
  TRANSCRIPTS_GLOBAL,
  TRANSCRIPTS_LINE,
} from '../context-rules-patches.ts';
import { applies } from '../rebase.ts';
import { describeStrayNames, occurrences, patchNamed, payloadFunction } from './payload.ts';
import { shipped, stockDroid as stock, stockText } from './stock-scanner.ts';

const SHOW_PATH = patchNamed(contextRulesPatches, 'cursor-rules-show-home-path');
const PERSONAL = patchNamed(contextRulesPatches, 'cursor-rules-count-as-personal');
const LOOKUP = patchNamed(contextRulesPatches, 'transcripts-folder-lookup');

const HELPERS = `${ALWAYS_APPLY}${RULES_LOADER}`;

describeStrayNames(contextRulesPatches);

const parseRule = payloadFunction<[], (text: string) => string | undefined>(
  [],
  `${HELPERS}return $ODalways`,
)();

describe('only a rule with alwaysApply: true is selected', () => {
  test('keeps the body of an always-applied rule and drops the frontmatter', () => {
    const text = '---\ndescription: Models\nalwaysApply: true\n---\n\nUse opus.\nSecond line.\n';
    expect(parseRule(text)).toBe('Use opus.\nSecond line.');
  });

  test.each([
    ['alwaysApply: false', '---\nalwaysApply: false\n---\nbody\n'],
    ['no alwaysApply key', '---\ndescription: Models\n---\nbody\n'],
    ['globs only', '---\nglobs: **/*.ts\n---\nbody\n'],
    ['description only', '---\ndescription: Use for models\n---\nbody\n'],
    ['globs with alwaysApply false', '---\nglobs: *.ts\nalwaysApply: false\n---\nbody\n'],
    ['no frontmatter', 'alwaysApply: true\nbody\n'],
    ['a word that only starts with true', '---\nalwaysApply: trueish\n---\nbody\n'],
    ['alwaysApply inside the body', '---\ndescription: x\n---\nalwaysApply: true\n'],
    ['an empty body', '---\nalwaysApply: true\n---\n\n\n'],
  ])('skips %s', (_case, text) => {
    expect(parseRule(text)).toBeUndefined();
  });

  test('reads globs that are not valid YAML', () => {
    const text = '---\nglobs: *.ts, src/**/*.tsx\nalwaysApply: true\n---\nbody';
    expect(parseRule(text)).toBe('body');
  });

  test('reads alwaysApply with a trailing comment', () => {
    const text = '---\nalwaysApply: true # every session\n---\nbody';
    expect(parseRule(text)).toBe('body');
  });

  test('accepts Windows line endings and a byte order mark', () => {
    const text = '\uFEFF---\r\nalwaysApply: true\r\n---\r\nbody\r\n';
    expect(parseRule(text)).toBe('body');
  });

  test('keeps a divider line inside the body', () => {
    const text = '---\nalwaysApply: true\n---\nabove\n---\nbelow\n';
    expect(parseRule(text)).toBe('above\n---\nbelow');
  });
});

interface Rule {
  filePath: string;
  fileName: string;
  content: string;
  isPersonal: boolean;
  odCmd?: string;
}

type Loader = (start: string) => Promise<Rule[]>;

function alwaysRule(body: string): string {
  return `---\nalwaysApply: true\n---\n${body}\n`;
}

let scratch = '';
let home = '';
let repo = '';

function write(file: string, text: string): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
}

function loaderWith(gitRoot: (start: string) => string | null, homeDir = home): Loader {
  return payloadFunction<
    [typeof path, { homedir: () => string }, typeof fs, (start: string) => string | null],
    Loader
  >(['K', 'Q', 'tt', 'En'], `${HELPERS}return $ODrules`)(
    path,
    { homedir: () => homeDir },
    fs,
    gitRoot,
  );
}

function insideRepo(start: string): string | null {
  return start.startsWith(repo) ? repo : null;
}

beforeAll(() => {
  scratch = fs.realpathSync(fs.mkdtempSync(path.join(tmpdir(), 'cursor-rules-')));
  home = path.join(scratch, 'home');
  repo = path.join(home, 'work', 'repo');
  const rules = path.join(repo, '.cursor', 'rules');
  write(path.join(rules, 'b.mdc'), alwaysRule('BRAVO'));
  write(path.join(rules, 'a.mdc'), alwaysRule('ALPHA'));
  write(path.join(rules, 'off.mdc'), '---\nalwaysApply: false\n---\nOFF\n');
  write(path.join(rules, 'globs.mdc'), '---\nglobs: *.ts\n---\nGLOBS\n');
  write(path.join(rules, 'plain.mdc'), 'PLAIN\n');
  write(path.join(rules, 'notes.md'), alwaysRule('WRONG EXTENSION'));
  write(path.join(rules, 'folder.mdc', 'inner.txt'), 'x');
  write(path.join(repo, 'pkg', '.cursor', 'rules', 'nested.mdc'), alwaysRule('NESTED'));
  write(path.join(home, '.cursor', 'rules', 'models.mdc'), alwaysRule('MODELS'));
  write(path.join(scratch, 'plain', '.cursor', 'rules', 'own.mdc'), alwaysRule('OWN'));
  write(path.join(scratch, 'plain', 'deep', 'x.txt'), 'x');
});

afterAll(() => {
  fs.rmSync(scratch, { recursive: true, force: true });
});

describe('the rule loader', () => {
  test('lists project rules sorted by name, then the home rules', async () => {
    const rules = await loaderWith(insideRepo)(repo);
    expect(rules.map((rule) => rule.content)).toEqual(['ALPHA', 'BRAVO', 'MODELS']);
    expect(rules.map((rule) => rule.isPersonal)).toEqual([false, false, true]);
  });

  test('reads the git root, not the session directory', async () => {
    const rules = await loaderWith(insideRepo)(path.join(repo, 'pkg'));
    expect(rules.map((rule) => rule.content)).toEqual(['ALPHA', 'BRAVO', 'MODELS']);
  });

  test('gives each rule its full path and file name', async () => {
    const [first] = await loaderWith(insideRepo)(repo);
    expect(first?.filePath).toBe(path.join(repo, '.cursor', 'rules', 'a.mdc'));
    expect(first?.fileName).toBe('a.mdc');
    expect(first?.odCmd).toBeUndefined();
  });

  test('shows a home rule with a tilde path', async () => {
    const rules = await loaderWith(insideRepo)(repo);
    const personal = rules.find((rule) => rule.isPersonal);
    expect(personal?.odCmd).toBe('~/.cursor/rules/models.mdc');
    expect(personal?.filePath).toBe(path.join(home, '.cursor', 'rules', 'models.mdc'));
  });

  test('uses the session directory itself outside a git repository', async () => {
    const rules = await loaderWith(() => null)(path.join(scratch, 'plain'));
    expect(rules.map((rule) => rule.content)).toEqual(['OWN', 'MODELS']);
  });

  test('finds no project rules in a subfolder of a non-git directory', async () => {
    const rules = await loaderWith(() => null)(path.join(scratch, 'plain', 'deep'));
    expect(rules.map((rule) => rule.content)).toEqual(['MODELS']);
  });

  test('loads the home rules once when the session starts in the home directory', async () => {
    const rules = await loaderWith(() => null)(home);
    expect(rules.map((rule) => [rule.content, rule.isPersonal])).toEqual([['MODELS', true]]);
  });

  test('loads the home rules once when the git root is the home directory', async () => {
    const rules = await loaderWith(() => home)(path.join(home, 'elsewhere'));
    expect(rules.map((rule) => [rule.content, rule.isPersonal])).toEqual([['MODELS', true]]);
  });

  test('returns nothing when no rules folder exists', async () => {
    const empty = path.join(scratch, 'empty');
    fs.mkdirSync(empty);
    const rules = await loaderWith(() => null, path.join(scratch, 'nobody'))(empty);
    expect(rules).toEqual([]);
  });

  test('skips a file that cannot be read', async () => {
    const rules = await loaderWith(insideRepo)(repo);
    expect(rules.map((rule) => rule.fileName)).not.toContain('folder.mdc');
  });
});

describe('the command line shown for a rule', () => {
  const personalCheck = payloadFunction<[() => string[]], (entry: { cmd: string }) => boolean>(
    ['Ite'],
    `return ${PERSONAL.replace}`,
  )(() => ['.factory', '.agents', '.agent']);

  test.each([
    ['an AGENTS.md in the factory folder', 'cat ~/.factory/AGENTS.md', true],
    ['a home rule', 'cat ~/.cursor/rules/models.mdc', true],
    ['a project rule', 'cat /work/repo/.cursor/rules/a.mdc', false],
    ['a project AGENTS.md', 'cat /work/repo/AGENTS.md', false],
  ])('%s counts as personal: %s', (_case, cmd, expected) => {
    expect(personalCheck({ cmd })).toBe(expected);
  });

  const display = payloadFunction<[typeof path], (entry: Partial<Rule>) => string>(
    ['K'],
    `return ${SHOW_PATH.replace}\`~/\${K.basename(K.dirname(e.filePath))}/\${e.fileName}\`}`,
  )(path);

  test('a home rule shows its tilde path', () => {
    expect(
      display({
        odCmd: '~/.cursor/rules/x.mdc',
        isPersonal: true,
        filePath: '/h/.cursor/rules/x.mdc',
      }),
    ).toBe('~/.cursor/rules/x.mdc');
  });

  test('a project rule shows its full path', () => {
    expect(display({ isPersonal: false, filePath: '/work/repo/.cursor/rules/x.mdc' })).toBe(
      '/work/repo/.cursor/rules/x.mdc',
    );
  });

  test('a personal AGENTS.md keeps its tilde path', () => {
    expect(
      display({ isPersonal: true, filePath: '/h/.factory/AGENTS.md', fileName: 'AGENTS.md' }),
    ).toBe('~/.factory/AGENTS.md');
  });
});

type Lookup = (cwd: string) => string;

function workspaceLines(cwd: string | undefined, shell: string): string {
  return payloadFunction<[string | undefined, () => string], string>(
    ['M', 'Lhe'],
    `return [M?Lhe(M):"",${TRANSCRIPTS_LINE}].filter(Boolean).join("\\n")`,
  )(cwd, () => shell);
}

function install(lookup: Lookup): void {
  Reflect.set(globalThis, TRANSCRIPTS_GLOBAL, lookup);
}

describe('the transcripts line in the system info', () => {
  afterEach(() => {
    Reflect.deleteProperty(globalThis, TRANSCRIPTS_GLOBAL);
  });

  test('names the folder the session store gives for the working directory', () => {
    const asked: string[] = [];
    install((cwd) => {
      asked.push(cwd);
      return '/home/me/.factory/sessions/-work-repo';
    });
    expect(workspaceLines('/work/repo', '')).toBe(
      'Agent transcripts for this project: /home/me/.factory/sessions/-work-repo/ (one <session-id>.jsonl per session)',
    );
    expect(asked).toEqual(['/work/repo']);
  });

  test('goes on its own line after the existing workspace text', () => {
    install(() => '/s/-p');
    expect(workspaceLines('/p', 'Workspace: p')).toBe(
      'Workspace: p\nAgent transcripts for this project: /s/-p/ (one <session-id>.jsonl per session)',
    );
  });

  test('adds nothing before the session store is ready', () => {
    expect(workspaceLines('/p', '')).toBe('');
  });

  test('adds nothing without a working directory', () => {
    install(() => '/s/-p');
    expect(workspaceLines(undefined, '')).toBe('');
  });

  test('adds nothing when the session store fails', () => {
    install(() => {
      throw new Error('no store');
    });
    expect(workspaceLines('/p', 'Workspace: p')).toBe('Workspace: p');
  });
});

describe('the session store hands out its transcripts folder', () => {
  afterEach(() => {
    Reflect.deleteProperty(globalThis, TRANSCRIPTS_GLOBAL);
  });

  test('the lookup asks the store that owns the sessions folder', () => {
    const body =
      `${LOOKUP.replace}this.ready=!0}` +
      `getSessionsDirectory(c){return sn.join(this.sessionsDir,"-"+c.replaceAll("/","-"))}` +
      `ensureSessionsDirectory(){}` +
      `ask(c){return globalThis.${TRANSCRIPTS_GLOBAL}(c)}`;
    const Store = payloadFunction<
      [typeof path, () => string, () => string],
      new () => { ready: boolean; ask: (cwd: string) => string }
    >(['sn', 'L', 'w'], `return class{${body}}`)(
      path,
      () => '/home/me',
      () => '.factory',
    );
    const store = new Store();
    expect(store.ready).toBe(true);
    expect(store.ask('/work/repo')).toBe('/home/me/.factory/sessions/--work-repo');
  });
});

const { patchedText, rebasedNamed } = shipped(contextRulesPatches);

describe.skipIf(stock === undefined)('the shipped system info code', () => {
  test.each(contextRulesPatches.map((patch) => [patch.name] as const))(
    '%s anchors once and applies',
    (name) => {
      const rebase = rebasedNamed(name);
      expect(applies(rebase)).toBe(true);
      expect(occurrences(stockText, rebase.find)).toBe(1);
      expect(occurrences(patchedText, rebase.find)).toBe(0);
    },
  );

  test('the rules join the list before the size limit is applied', () => {
    const start = patchedText.indexOf('...await $ODrules(');
    const limit = patchedText.indexOf('guidelines exceed', start);
    expect(start).toBeGreaterThan(-1);
    expect(limit).toBeGreaterThan(start);
  });
});
