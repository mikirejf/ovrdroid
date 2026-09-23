import { afterAll, describe, expect, test } from 'bun:test';
import { writeFileSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import path from 'node:path';

import { makeTempDir } from '../../temp.ts';
import { isBackgroundSession, sessionSettingsFile } from '../background-session.ts';
import { readSound } from '../notify-sound.ts';

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

describe('sessionSettingsFile', () => {
  test('sits beside the transcript under the session id', () => {
    expect(sessionSettingsFile('/s/-Users-me/abc.jsonl', 'def')).toBe(
      '/s/-Users-me/def.settings.json',
    );
  });
});

describe('isBackgroundSession', () => {
  test('a subagent session is background', async () => {
    const file = settingsFile(
      'subagent.json',
      '{"tags":[{"name":"subagent","metadata":{"callingSessionId":"x"}}]}',
    );
    expect(await isBackgroundSession(file)).toBe(true);
  });

  test('a droid exec session is background', async () => {
    expect(await isBackgroundSession(settingsFile('exec.json', '{"tags":[{"name":"exec"}]}'))).toBe(
      true,
    );
  });

  test('an untagged session is the user at the keyboard', async () => {
    expect(await isBackgroundSession(settingsFile('main.json', '{"model":"x"}'))).toBe(false);
  });

  test('other tags do not silence the prompt', async () => {
    const file = settingsFile('mission.json', '{"tags":[{"name":"mission-session"}]}');
    expect(await isBackgroundSession(file)).toBe(false);
  });

  test('a missing settings file does not silence the prompt', async () => {
    expect(await isBackgroundSession(path.join(base, 'absent.json'))).toBe(false);
  });

  test('a malformed settings file does not silence the prompt', async () => {
    expect(await isBackgroundSession(settingsFile('broken-session.json', '{ not json'))).toBe(
      false,
    );
  });
});
