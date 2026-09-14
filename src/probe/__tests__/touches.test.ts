import { describe, expect, test } from 'bun:test';
import { chmodSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { makeTempDir } from '../../temp.ts';
import type { Facts } from '../touches.ts';
import { factsOf, readingOf, touchesDuring, UNREADABLE } from '../touches.ts';

const BASE: Facts = {
  mode: '600',
  owner: '501:20',
  size: '10',
  links: '1',
  inode: '7',
  modifiedAt: '100',
  metadataChangedAt: '100',
  content: 'abc',
};

describe('readingOf tells a rewrite apart from a bare touch', () => {
  test('identical facts read as untouched', () => {
    const reading = readingOf(BASE, BASE);
    expect(reading.changes).toEqual([]);
    expect(reading.verdict).toContain('untouched');
  });

  test('a changed ctime alone is a no-op write, the kind that still wakes watchers', () => {
    const reading = readingOf(BASE, { ...BASE, metadataChangedAt: '200' });
    expect(reading.changes).toEqual(['metadataChangedAt']);
    expect(reading.verdict).toContain('byte-identical');
    expect(reading.verdict).toContain('watcher');
  });

  test('changed content is reported as a real rewrite', () => {
    const reading = readingOf(BASE, { ...BASE, content: 'zzz', size: '11', modifiedAt: '200' });
    expect(reading.verdict).toContain('bytes changed');
    expect(reading.changes).toContain('content');
  });

  test('appearing and vanishing files are named, not misread as edits', () => {
    const absent = undefined;
    expect(readingOf(absent, BASE).verdict).toContain('created');
    expect(readingOf(BASE, absent).verdict).toContain('deleted');
    expect(readingOf(absent, absent).verdict).toContain('absent');
  });
});

describe('factsOf reads the real filesystem', () => {
  test('a missing file has no facts', async () => {
    const facts = await factsOf(path.join(makeTempDir('touches'), 'nope'));
    expect(facts).toBeUndefined();
  });

  test('mode is reported in octal', async () => {
    const file = path.join(makeTempDir('touches'), 'f');
    writeFileSync(file, 'x', { mode: 0o600 });
    const facts = await factsOf(file);
    expect(facts?.mode).toBe('600');
  });

  test('a file that stats but cannot be read is named, not thrown over', async () => {
    const file = path.join(makeTempDir('touches'), 'locked.json');
    writeFileSync(file, '{}', { mode: 0o600 });
    chmodSync(file, 0o000);

    const facts = await factsOf(file);
    expect(facts?.content).toBe(UNREADABLE);
    expect(readingOf(facts, facts).verdict).toContain('unreadable');
  });
});

describe('touchesDuring catches what an action did to a file', () => {
  test('a no-op chmod is caught and named as a metadata-only touch', async () => {
    const file = path.join(makeTempDir('touches'), 'settings.json');
    writeFileSync(file, '{}', { mode: 0o600 });

    const [reading] = await touchesDuring([file], async () => {
      await Bun.sleep(10);
      chmodSync(file, 0o600);
    });

    expect(reading?.changes).toEqual(['metadataChangedAt']);
    expect(reading?.verdict).toContain('byte-identical');
  });

  test('an untouched file is reported untouched', async () => {
    const file = path.join(makeTempDir('touches'), 'quiet.json');
    writeFileSync(file, '{}', { mode: 0o600 });

    const [reading] = await touchesDuring([file], async () => {
      await Bun.sleep(10);
    });

    expect(reading?.verdict).toContain('untouched');
  });
});
