import { afterAll, describe, expect, test } from 'bun:test';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { FACTORY_DROIDS } from '../../paths.ts';
import { projectDroidsFolder, withProjectDroid, withScratchProject } from '../project-droid.ts';
import { droidFileText } from '../rewind.ts';

const root = mkdtempSync(path.join(tmpdir(), 'project-droid-'));
const TYPE = 'ovrdroid-project-droid-test';
const DROID = { type: TYPE, text: droidFileText(TYPE) };

afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});

function fresh(name: string): string {
  const cwd = path.join(root, name);
  mkdirSync(cwd);
  return cwd;
}

async function later<T>(value: T): Promise<T> {
  return await Promise.resolve(value);
}

async function failureOf(run: Promise<unknown>): Promise<string> {
  try {
    await run;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
  return 'did not fail';
}

describe('withProjectDroid', () => {
  test('the droid file exists in the project folder while use runs and is gone after', async () => {
    const cwd = fresh('plain');
    const file = path.join(projectDroidsFolder(cwd), `${TYPE}.md`);
    const seen = await withProjectDroid(
      cwd,
      DROID,
      async () => await later(readFileSync(file, 'utf-8')),
    );
    expect(seen).toBe(DROID.text);
    expect(existsSync(file)).toBe(false);
  });

  test('folders it created are removed with the file', async () => {
    const cwd = fresh('created');
    await withProjectDroid(cwd, DROID, async () => await later(0));
    expect(existsSync(path.join(cwd, '.factory'))).toBe(false);
  });

  test('a droids folder that already existed stays, with its other droids', async () => {
    const cwd = fresh('existing');
    const folder = projectDroidsFolder(cwd);
    mkdirSync(folder, { recursive: true });
    writeFileSync(path.join(folder, 'mine.md'), 'keep');
    await withProjectDroid(cwd, DROID, async () => await later(0));
    expect(readFileSync(path.join(folder, 'mine.md'), 'utf-8')).toBe('keep');
    expect(existsSync(path.join(folder, `${TYPE}.md`))).toBe(false);
  });

  test('the file is removed when use throws, and the error comes through', async () => {
    const cwd = fresh('throws');
    const message = await failureOf(
      withProjectDroid(cwd, DROID, async () => {
        await later(0);
        throw new Error('boom');
      }),
    );
    expect(message).toBe('boom');
    expect(existsSync(path.join(cwd, '.factory'))).toBe(false);
  });

  test('a droid file Droid cannot read as a droid fails before use runs', async () => {
    const cwd = fresh('unreadable');
    let ran = false;
    const message = await failureOf(
      withProjectDroid(cwd, { type: TYPE, text: 'no front matter' }, async () => {
        ran = true;
        return await later(0);
      }),
    );
    expect(message).toContain(`would not offer the project-local droid ${TYPE}`);
    expect(ran).toBe(false);
    expect(existsSync(path.join(cwd, '.factory'))).toBe(false);
  });

  test('it never writes into the personal droid folder', async () => {
    const cwd = fresh('personal');
    const inPersonal = await withProjectDroid(
      cwd,
      DROID,
      async () => await later(existsSync(path.join(FACTORY_DROIDS, `${TYPE}.md`))),
    );
    expect(inPersonal).toBe(false);
  });
});

describe('withScratchProject', () => {
  test('runs in a fresh folder under /tmp that holds the droid, and removes the folder after', async () => {
    const seen = await withScratchProject('project-droid-test', DROID, async ({ dir, cwd }) => {
      const droid = path.join(projectDroidsFolder(cwd), `${TYPE}.md`);
      return await later({ dir, cwd, text: readFileSync(droid, 'utf-8') });
    });
    expect(seen.text).toBe(DROID.text);
    expect(seen.cwd).toBe(path.join(seen.dir, 'work'));
    expect(seen.dir.startsWith(realpathSync('/tmp'))).toBe(true);
    expect(existsSync(seen.dir)).toBe(false);
  });
});
