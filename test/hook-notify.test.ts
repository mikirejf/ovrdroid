import { afterAll, describe, expect, test } from 'bun:test';
import { writeFileSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import path from 'node:path';

import { readSound } from '../src/notify-sound.ts';
import { makeTempDir } from '../src/temp.ts';

const base = makeTempDir('notify');

afterAll(async () => {
  await rm(base, { recursive: true, force: true });
});

function settingsFile(name: string, contents: string): string {
  const file = path.join(base, name);
  writeFileSync(file, contents);
  return file;
}

describe('readSound', () => {
  test('falls back to the default when the file is absent', async () => {
    expect(await readSound(path.join(base, 'nothing-here.json'))).toBe('fx-ack01');
  });

  test('falls back to the default when the file is malformed', async () => {
    expect(await readSound(settingsFile('broken.json', '{ not json'))).toBe('fx-ack01');
  });

  test('falls back to the default when the key is absent', async () => {
    expect(await readSound(settingsFile('empty.json', '{}'))).toBe('fx-ack01');
  });

  test('falls back to the default when the value is not a string', async () => {
    expect(await readSound(settingsFile('number.json', '{"awaitingInputSound":7}'))).toBe(
      'fx-ack01',
    );
  });

  test('reads the configured sound', async () => {
    expect(await readSound(settingsFile('set.json', '{"awaitingInputSound":"bell"}'))).toBe('bell');
  });
});
