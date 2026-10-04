import { afterAll, describe, expect, test } from 'bun:test';
import { writeFileSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import path from 'node:path';

import { FACTORY_SOUNDS } from '../../paths.ts';
import { makeTempDir } from '../../temp.ts';
import { isBackgroundSession, sessionSettingsFile } from '../background-session.ts';
import type { Surroundings } from '../notify-sound.ts';
import { playSound, readSound } from '../notify-sound.ts';

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

interface Launched {
  command: string;
  args: string[];
}

interface Heard {
  launched: Launched[];
  bells: number;
}

type Conditions = Partial<Pick<Surroundings, 'platform' | 'herdr' | 'herdrBinary'>>;

const HERDR_REQUEST = ['notification', 'show', 'Droid needs approval', '--sound', 'request'];

function hear(
  sound: string,
  { platform = 'darwin', herdr = false, herdrBinary = 'herdr' }: Conditions = {},
): Heard {
  const heard: Heard = { launched: [], bells: 0 };
  playSound(sound, {
    platform,
    herdr,
    herdrBinary,
    launch: (command, args) => {
      heard.launched.push({ command, args });
    },
    ringBell: () => {
      heard.bells += 1;
    },
  });
  return heard;
}

describe('playSound inside herdr', () => {
  test('asks herdr for the request sound', () => {
    expect(hear('fx-ack01', { herdr: true })).toEqual({
      launched: [{ command: 'herdr', args: HERDR_REQUEST }],
      bells: 0,
    });
  });

  test('HERDR_BIN_PATH names the binary', () => {
    const heard = hear('fx-ack01', { herdr: true, herdrBinary: '/opt/herdr/bin/herdr' });
    expect(heard.launched).toEqual([{ command: '/opt/herdr/bin/herdr', args: HERDR_REQUEST }]);
  });

  test('a custom sound is ignored in favour of the request sound', () => {
    const heard = hear('/sounds/mine.wav', { herdr: true });
    expect(heard.launched).toEqual([{ command: 'herdr', args: HERDR_REQUEST }]);
  });

  test('it still calls herdr on a platform other than macOS', () => {
    const heard = hear('fx-ack01', { herdr: true, platform: 'linux' });
    expect(heard.launched).toEqual([{ command: 'herdr', args: HERDR_REQUEST }]);
  });

  test('off stays silent', () => {
    expect(hear('off', { herdr: true })).toEqual({ launched: [], bells: 0 });
  });

  test('bell still rings the terminal bell and does not call herdr', () => {
    expect(hear('bell', { herdr: true })).toEqual({ launched: [], bells: 1 });
  });
});

describe('playSound outside herdr', () => {
  test('a named sound plays through afplay on macOS', () => {
    expect(hear('fx-ack01')).toEqual({
      launched: [{ command: '/usr/bin/afplay', args: [path.join(FACTORY_SOUNDS, 'fx-ack01.wav')] }],
      bells: 0,
    });
  });

  test('a sound with a path plays that file', () => {
    const file = path.join('/sounds', 'mine.wav');
    expect(hear(file).launched).toEqual([{ command: '/usr/bin/afplay', args: [file] }]);
  });

  test('a platform other than macOS stays silent', () => {
    expect(hear('fx-ack01', { platform: 'linux' })).toEqual({ launched: [], bells: 0 });
  });

  test('off stays silent', () => {
    expect(hear('off')).toEqual({ launched: [], bells: 0 });
  });

  test('bell rings the terminal bell', () => {
    expect(hear('bell')).toEqual({ launched: [], bells: 1 });
  });
});
