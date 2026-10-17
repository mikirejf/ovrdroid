import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { diffStatsPatches } from '../diff-stats-patches.ts';
import { FooterWorld } from './footer-harness.ts';
import { describeStrayNames, patchNamed, payloadFunction } from './payload.ts';

interface Run {
  ok: boolean;
  stdout: string;
  stderr: string;
}

type Runner = (cwd: string, command: string, args: string[]) => Run;

interface Stats {
  additions?: number;
  deletions?: number;
}

type State = Stats & { status: string };

interface PrState extends Stats {
  status: string;
  prUrl?: string;
  prNumber?: string;
}

interface Outcome {
  status: 'error' | 'absent';
}

interface Service {
  published: State[];
  pendingDetection: object | null;
  stale: State | null;
  applyOutcome: (cwd: string, outcome: Outcome) => State | Promise<State>;
  $ODstats: (cwd: string) => Promise<Stats>;
}

type ServiceClass = new () => Service;

interface Part {
  text: string;
  color: string | undefined;
}

type Display = (state: PrState) => Part[];

const GIT_ENV = {
  ...Bun.env,
  GIT_CONFIG_GLOBAL: '/dev/null',
  GIT_CONFIG_SYSTEM: '/dev/null',
  GIT_AUTHOR_NAME: 'test',
  GIT_AUTHOR_EMAIL: 'test@example.com',
  GIT_COMMITTER_NAME: 'test',
  GIT_COMMITTER_EMAIL: 'test@example.com',
};

const DETECTION = patchNamed(diffStatsPatches, 'diff-stats-without-pr');
const DISPLAY = patchNamed(diffStatsPatches, 'diff-stats-footer-without-pr');
const METHOD_START = 'async $ODstats(';
const METHOD_END = 'takeStaleFound(';
const SERVICE_FIELDS =
  'state={status:"idle"};stateCwd=null;pendingDetection=null;lastFound=null;lookupFailing=!1;stale=null;published=[];' +
  'publish(t,s){this.state=t;this.stateCwd=s;this.published.push(t);return t}';
const APPLY_OUTCOME = `applyOutcome(t,s){switch(s.status){case"error":${DETECTION.replace}t){return this.stale}`;
const CWD = '/repo';
const THEME = { gitAdditions: 'green', gitDeletions: 'red' };

function diffSays(stdout: string | null): Runner {
  return (_cwd, _command, args) =>
    stdout !== null && args[0] === 'diff'
      ? { ok: true, stdout, stderr: '' }
      : { ok: false, stdout: '', stderr: 'fatal' };
}

const FAKE_STATS = diffSays(' 1 file changed, 4 insertions(+), 2 deletions(-)');
const BROKEN = diffSays(null);
const CLEAN = diffSays('');
const ONE_ADDED = diffSays(' 1 file changed, 1 insertion(+)');

function git(cwd: string, ...args: string[]): string {
  const done = Bun.spawnSync(['git', ...args], { cwd, env: GIT_ENV });
  if (done.exitCode !== 0) {
    throw new Error(`git ${args.join(' ')} failed: ${done.stderr.toString()}`);
  }
  return done.stdout.toString().trim();
}

function runInCwd(cwd: string, command: string, args: string[]): Run {
  const done = Bun.spawnSync([command, ...args], { cwd, env: GIT_ENV });
  return {
    ok: done.exitCode === 0,
    stdout: done.stdout.toString().trim(),
    stderr: done.stderr.toString().trim(),
  };
}

function lines(count: number, prefix = 'line'): string {
  return Array.from({ length: count }, (_value, index) => `${prefix} ${index}\n`).join('');
}

function commitFile(cwd: string, name: string, text: string): void {
  writeFileSync(path.join(cwd, name), text);
  git(cwd, 'add', '.');
  git(cwd, 'commit', '-m', `write ${name}`);
}

function repoWithOrigin(root: string): string {
  const seed = path.join(root, 'seed');
  const origin = path.join(root, 'origin.git');
  const work = path.join(root, 'work');
  mkdirSync(seed);
  git(seed, 'init', '-b', 'main');
  commitFile(seed, 'a.txt', lines(5));
  git(root, 'clone', '--bare', seed, origin);
  git(root, 'clone', origin, work);
  return work;
}

function serviceOver(runner: Runner, methods: string): Service {
  const build = payloadFunction<[Runner, (value: never) => never], ServiceClass>(
    ['f', 're'],
    `return class{${SERVICE_FIELDS}${methods}}`,
  );
  const Class = build(runner, (value) => value);
  return new Class();
}

async function statsIn(cwd: string): Promise<Stats> {
  const method = DETECTION.replace.slice(
    DETECTION.replace.indexOf(METHOD_START),
    DETECTION.replace.lastIndexOf(METHOD_END),
  );
  return await serviceOver(runInCwd, method).$ODstats(cwd);
}

async function published(runner: Runner, failing: boolean): Promise<State[]> {
  const service = serviceOver(runner, APPLY_OUTCOME);
  await service.applyOutcome(CWD, { status: failing ? 'error' : 'absent' });
  return service.published;
}

const display = payloadFunction<[typeof THEME], Display>(
  ['a'],
  'let rt=(text,style)=>({text,color:style?.color});' +
    `return function(f){${DISPLAY.replace}return[{text:"pull request",color:"none"}]}`,
)(THEME);

async function settle(): Promise<void> {
  await Promise.resolve();
}

describeStrayNames(diffStatsPatches);

describe('where the line counts come from', () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(path.join(tmpdir(), 'ds-test-'));
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  test('a folder that is not a git repo has no counts at all', async () => {
    expect(await statsIn(root)).toEqual({});
  });

  test('a clean repo with no origin shows zero and zero', async () => {
    git(root, 'init', '-b', 'main');
    commitFile(root, 'a.txt', lines(5));

    expect(await statsIn(root)).toEqual({ additions: 0, deletions: 0 });
  });

  test('without an origin, edits not yet committed are counted against HEAD', async () => {
    git(root, 'init', '-b', 'main');
    commitFile(root, 'a.txt', lines(5));
    writeFileSync(path.join(root, 'a.txt'), lines(8));

    expect(await statsIn(root)).toEqual({ additions: 3, deletions: 0 });
  });

  test('a repo with no commit has no counts', async () => {
    git(root, 'init', '-b', 'main');

    expect(await statsIn(root)).toEqual({});
  });

  test('on a branch, committed and uncommitted edits both count against the default branch', async () => {
    const work = repoWithOrigin(root);
    git(work, 'switch', '-c', 'feature');
    commitFile(work, 'a.txt', lines(7));
    writeFileSync(path.join(work, 'a.txt'), lines(6));

    expect(await statsIn(work)).toEqual({ additions: 1, deletions: 0 });
  });

  test('commits that landed on the default branch since the fork are not counted', async () => {
    const work = repoWithOrigin(root);
    git(work, 'switch', '-c', 'feature');
    commitFile(work, 'a.txt', lines(7));
    git(work, 'switch', 'main');
    commitFile(work, 'b.txt', lines(40, 'other'));
    git(work, 'push', 'origin', 'main');
    git(work, 'switch', 'feature');

    expect(await statsIn(work)).toEqual({ additions: 2, deletions: 0 });
  });

  test('deleted lines are counted as deletions', async () => {
    const work = repoWithOrigin(root);
    writeFileSync(path.join(work, 'a.txt'), lines(2));

    expect(await statsIn(work)).toEqual({ additions: 0, deletions: 3 });
  });
});

describe('what the service publishes when no PR is found', () => {
  test('the not-found state carries the counts', async () => {
    expect(await published(FAKE_STATS, false)).toEqual([
      { status: 'not-found', additions: 4, deletions: 2 },
    ]);
  });

  test('the error state carries the counts', async () => {
    expect(await published(FAKE_STATS, true)).toEqual([
      { status: 'error', additions: 4, deletions: 2 },
    ]);
  });

  test('a failed diff leaves the state as stock publishes it', async () => {
    expect(await published(BROKEN, false)).toEqual([{ status: 'not-found' }]);
    expect(await published(BROKEN, true)).toEqual([{ status: 'error' }]);
  });

  test('a diff with no change publishes zero and zero', async () => {
    expect(await published(CLEAN, false)).toEqual([
      { status: 'not-found', additions: 0, deletions: 0 },
    ]);
  });

  test('a change that only adds reads as the added lines and zero', async () => {
    expect(await published(ONE_ADDED, false)).toEqual([
      { status: 'not-found', additions: 1, deletions: 0 },
    ]);
  });

  test('git runs in the folder the lookup was for', async () => {
    const folders: string[] = [];
    const runner: Runner = (cwd, command, args) => {
      folders.push(cwd);
      return FAKE_STATS(cwd, command, args);
    };
    await published(runner, false);

    expect(new Set(folders)).toEqual(new Set([CWD]));
  });

  test('a failed lookup that keeps a recent PR publishes that PR without running git', async () => {
    const calls: string[][] = [];
    const runner: Runner = (cwd, command, args) => {
      calls.push(args);
      return FAKE_STATS(cwd, command, args);
    };
    const service = serviceOver(runner, APPLY_OUTCOME);
    const recent = { status: 'found', prUrl: 'u', prNumber: '7', additions: 9, deletions: 1 };
    service.stale = recent;
    await service.applyOutcome(CWD, { status: 'error' });

    expect(service.published).toEqual([recent]);
    expect(calls).toEqual([]);
  });

  test('a lookup overtaken by a newer one while counting publishes nothing', async () => {
    const service = serviceOver(FAKE_STATS, APPLY_OUTCOME);
    service.pendingDetection = {};
    const outcome = service.applyOutcome(CWD, { status: 'absent' });
    service.pendingDetection = {};
    await outcome;

    expect(service.published).toEqual([]);
  });
});

describe('what the footer shows', () => {
  test('with no PR and counts, it shows plus and minus in the diff colours', () => {
    expect(display({ status: 'not-found', additions: 3, deletions: 1 })).toEqual([
      { text: '+3', color: 'green' },
      { text: ' ', color: undefined },
      { text: '-1', color: 'red' },
    ]);
  });

  test('a clean repo shows plus zero and minus zero', () => {
    const parts = display({ status: 'not-found', additions: 0, deletions: 0 });

    expect(parts.map((part) => part.text)).toEqual(['+0', ' ', '-0']);
  });

  test('with no counts, it shows nothing', () => {
    expect(display({ status: 'not-found' })).toEqual([]);
    expect(display({ status: 'idle' })).toEqual([]);
    expect(display({ status: 'loading' })).toEqual([]);
  });

  test('a found PR is left to the stock code', () => {
    const found = { status: 'found', prUrl: 'u', prNumber: '7', additions: 3, deletions: 1 };

    expect(display(found).map((part) => part.text)).toEqual(['pull request']);
  });
});

describe('when the PR service refreshes after a turn', () => {
  let footer: FooterWorld;

  beforeEach(() => {
    footer = new FooterWorld();
  });

  afterEach(() => {
    FooterWorld.reset();
  });

  test('it does not refresh while the session is idle or busy', async () => {
    footer.render('idle');
    footer.render('idle');
    footer.render('streaming');
    footer.render('streaming');
    await settle();

    expect(footer.prRefreshes).toBe(0);
  });

  test('it refreshes once when a turn ends', async () => {
    footer.render('idle');
    footer.render('streaming');
    footer.render('idle');
    await settle();

    expect(footer.prRefreshes).toBe(1);
  });

  test('more renders after the turn ended do not refresh again', async () => {
    footer.render('idle');
    footer.render('streaming');
    footer.render('idle');
    footer.render('idle');
    footer.render('idle');
    await settle();

    expect(footer.prRefreshes).toBe(1);
  });

  test('a tool call in the middle of a turn is not the end of the turn', async () => {
    footer.render('idle');
    footer.render('thinking');
    footer.render('executing_tool');
    footer.render('streaming');
    await settle();

    expect(footer.prRefreshes).toBe(0);
  });

  test('each turn refreshes once', async () => {
    footer.render('idle');
    for (let turn = 0; turn < 3; turn += 1) {
      footer.render('streaming');
      footer.render('idle');
    }
    await settle();

    expect(footer.prRefreshes).toBe(3);
  });
});
