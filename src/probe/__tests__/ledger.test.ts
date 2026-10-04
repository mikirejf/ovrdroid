import { afterAll, describe, expect, test } from 'bun:test';
import { mkdirSync, readdirSync, readFileSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import path from 'node:path';

import {
  LEDGER_VARIABLE,
  ledgerHooks,
  mayDelete,
  missingHookMessage,
  newestSqliteLibrary,
  readLedger,
  registration,
  sessionFiles,
  sessionFolderName,
} from '../ledger.ts';
import { scriptDir } from './scripts.ts';

const ROOT = '/home/me/.factory/sessions';
const ID = '18adae9e-b1a8-4d8f-a1c3-439dfd6be68d';
const OTHER = '30072f49-cecb-473e-b69e-973f3efd7ce6';
const dir = scriptDir('ledger');

afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

function hookLine(id: string, transcript: string, event = 'SessionEnd'): string {
  return JSON.stringify({
    session_id: id,
    transcript_path: transcript,
    cwd: '/tmp',
    hook_event_name: event,
  });
}

const HOOK = ledgerHooks().SessionStart[0]?.hooks[0]?.command ?? '';

function hookEnv(ledger?: string) {
  const base = { PATH: Bun.env['PATH'] ?? '' };
  return ledger === undefined ? base : { ...base, [LEDGER_VARIABLE]: ledger };
}

function runHook(stdin: string, ledger?: string) {
  return Bun.spawnSync(['sh', '-c', HOOK], { stdin: Buffer.from(stdin), env: hookEnv(ledger) });
}

function ledgerDir(name: string): string {
  const ledger = path.join(dir, name);
  mkdirSync(ledger);
  return ledger;
}

function records(ledger: string): string[] {
  return readdirSync(ledger).map((name) => readFileSync(path.join(ledger, name), 'utf-8'));
}

function sessionId(index: number): string {
  return `${index.toString(16).padStart(8, '0')}-0000-4000-8000-000000000000`;
}

describe('the ledger hook', () => {
  test('writes what Droid pipes in to a new file in the folder the launch named', () => {
    const ledger = ledgerDir('one');
    const first = runHook(hookLine(ID, `${ROOT}/-p/${ID}.jsonl`, 'SessionStart'), ledger);
    runHook(hookLine(ID, `${ROOT}/-p/${ID}.jsonl`), ledger);
    expect(first.exitCode).toBe(0);
    expect(first.stdout.toString()).toBe('');
    expect(records(ledger)).toHaveLength(2);
    expect(readLedger(records(ledger), ROOT)).toEqual([
      { id: ID, transcript: `${ROOT}/-p/${ID}.jsonl` },
    ]);
  });

  test('keeps every record when many hooks fire at once', async () => {
    const ledger = ledgerDir('many');
    const count = 24;
    const hooks = Array.from({ length: count }, (_, index) => {
      const id = sessionId(index);
      const child = Bun.spawn(['sh', '-c', HOOK], {
        stdin: 'pipe',
        env: hookEnv(ledger),
      });
      const event = index % 2 === 0 ? 'SessionStart' : 'SessionEnd';
      const line = hookLine(id, `${ROOT}/-p/${id}.jsonl`, event);
      void child.stdin.write(line.slice(0, 40));
      return { child, rest: line.slice(40) };
    });
    for (const { child, rest } of hooks) {
      void child.stdin.write(rest);
      void child.stdin.end();
    }
    await Promise.all(hooks.map(async ({ child }) => await child.exited));
    const found = readLedger(records(ledger), ROOT).map((session) => session.id);
    expect(found.toSorted()).toEqual(Array.from({ length: count }, (_, index) => sessionId(index)));
  });

  test.each([
    ['a Droid the probe did not launch', undefined],
    ['a Droid launched with the variable empty', ''],
    ['a Droid whose ledger folder the probe already removed', path.join(dir, 'gone')],
  ])('stays silent and succeeds in %s', (_, ledger) => {
    const result = runHook(hookLine(ID, `${ROOT}/-p/${ID}.jsonl`), ledger);
    expect(result.exitCode).toBe(0);
    expect(result.stdout.toString()).toBe('');
    expect(result.stderr.toString()).toBe('');
    expect(readdirSync(dir)).not.toContain('gone');
  });
});

describe('registration', () => {
  const bound = { boundMs: 5000 };
  const start = hookLine(ID, `${ROOT}/-p/${ID}.jsonl`, 'SessionStart');

  test('counts the session as registered once a SessionStart record arrived', () => {
    expect(registration([start], { ...bound, waitedMs: 0 })).toBe('registered');
    expect(registration([start], { ...bound, waitedMs: 9000 })).toBe('registered');
  });

  test('also counts a SessionEnd record, which is all an early Ctrl-C leaves', () => {
    const end = hookLine(ID, `${ROOT}/-p/${ID}.jsonl`, 'SessionEnd');
    expect(registration([end], { ...bound, waitedMs: 0 })).toBe('registered');
  });

  test('keeps waiting until the bound, then says the record is missing', () => {
    expect(registration([], { ...bound, waitedMs: 4999 })).toBe('waiting');
    expect(registration([], { ...bound, waitedMs: 5000 })).toBe('missing');
  });

  test('does not count another event or a record the hook is still writing', () => {
    const written = [hookLine(ID, `${ROOT}/-p/${ID}.jsonl`, 'Stop'), start.slice(0, 30), ''];
    expect(registration(written, { ...bound, waitedMs: 5000 })).toBe('missing');
  });
});

describe('sessionFolderName', () => {
  test('names the folder the way Droid does', () => {
    expect(sessionFolderName('/private/tmp/od-val')).toBe('-private-tmp-od-val');
    expect(sessionFolderName('/Users/me//dev/repo/')).toBe('-Users-me-dev-repo');
  });
});

describe('missingHookMessage', () => {
  test('says what failed, the likely causes, and where a session may remain', () => {
    const message = missingHookMessage('/home/me/.factory/sessions/-tmp-x', 5000);
    expect(message).toContain(
      "Droid ran neither the probe's SessionStart nor its SessionEnd hook within 5000ms",
    );
    expect(message).toContain('cannot identify and delete');
    expect(message).toContain('"hooksDisabled": true');
    expect(message).toContain('"allowManagedHooksOnly": true');
    expect(message).toContain('may remain in /home/me/.factory/sessions/-tmp-x');
  });
});

describe('readLedger', () => {
  test('lists each session once, even when start and end both reported it', () => {
    const lines = [
      hookLine(ID, `${ROOT}/-p/${ID}.jsonl`, 'SessionStart'),
      hookLine(ID, `${ROOT}/-p/${ID}.jsonl`),
      hookLine(OTHER, `${ROOT}/btw/${OTHER}.jsonl`),
    ];
    expect(readLedger(lines, ROOT).map((session) => session.id)).toEqual([ID, OTHER]);
  });

  test('skips a record a killed hook cut short', () => {
    const lines = [hookLine(ID, `${ROOT}/-p/${ID}.jsonl`), `{"session_id":"${OTHER}","tran`, ''];
    expect(readLedger(lines, ROOT).map((session) => session.id)).toEqual([ID]);
  });

  test('refuses a transcript outside the sessions folder', () => {
    expect(readLedger([hookLine(ID, `/home/me/notes/${ID}.jsonl`)], ROOT)).toEqual([]);
    expect(readLedger([hookLine(ID, `${ROOT}/../${ID}.jsonl`)], ROOT)).toEqual([]);
  });

  test('refuses a transcript whose name is not the session id', () => {
    expect(readLedger([hookLine(ID, `${ROOT}/-p/${OTHER}.jsonl`)], ROOT)).toEqual([]);
  });

  test('refuses an id that is not a session id', () => {
    expect(readLedger([hookLine('../../x', `${ROOT}/-p/../../x.jsonl`)], ROOT)).toEqual([]);
    expect(readLedger(['[1,2]', 'null', '"text"'], ROOT)).toEqual([]);
  });
});

describe('sessionFiles', () => {
  test('names the transcript, its settings and the settings backup, side by side', () => {
    expect(sessionFiles({ id: ID, transcript: `${ROOT}/-p/${ID}.jsonl` })).toEqual([
      `${ROOT}/-p/${ID}.jsonl`,
      `${ROOT}/-p/${ID}.settings.json`,
      `${ROOT}/-p/${ID}.settings.json.bak`,
    ]);
  });
});

describe('mayDelete', () => {
  const launchedAt = 1_000_000;

  test('deletes a transcript born after the launch', () => {
    expect(mayDelete(launchedAt + 0.5, launchedAt)).toBe(true);
  });

  test('keeps a transcript that existed before the launch, as a resumed session would', () => {
    expect(mayDelete(launchedAt - 1, launchedAt)).toBe(false);
  });

  test('keeps a transcript whose birth time the file system does not record', () => {
    expect(mayDelete(0, launchedAt)).toBe(false);
  });

  test('clears the index row of a session whose transcript Droid already removed', () => {
    expect(mayDelete(undefined, launchedAt)).toBe(true);
  });
});

describe('newestSqliteLibrary', () => {
  test('picks the newest SQLite library Droid unpacked, ignoring other files', () => {
    expect(
      newestSqliteLibrary([
        { name: 'libsqlite3-0000000000000000.dylib', mtimeMs: 1 },
        { name: 'libsqlite3-fc0ac0211c8b337a.dylib', mtimeMs: 3 },
        { name: 'libsqlite3-ffffffffffffffff.dylib.123.tmp', mtimeMs: 9 },
        { name: 'rg', mtimeMs: 5 },
      ]),
    ).toBe('libsqlite3-fc0ac0211c8b337a.dylib');
  });

  test('says when Droid has not unpacked one', () => {
    expect(newestSqliteLibrary([{ name: 'rg', mtimeMs: 1 }])).toBeUndefined();
  });
});
