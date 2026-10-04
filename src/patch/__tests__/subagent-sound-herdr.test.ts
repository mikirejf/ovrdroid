import { describe, expect, test } from 'bun:test';

import {
  completionHarness,
  HERDR_ARGS,
  HERDR_DONE_ARGS,
  HERDR_INSIDE,
  HERDR_OUTSIDE,
  WAIT_SOUND,
} from './sound-harness.ts';
import type { Herdr } from './sound-harness.ts';

describe('inside herdr the wait sound goes through herdr', () => {
  test('it runs herdr notification show and does not call the player', () => {
    const { finish, played, spawned } = completionHarness({ env: HERDR_INSIDE });
    finish(true);
    expect(spawned.map((call) => call.command)).toEqual([['herdr', ...HERDR_ARGS]]);
    expect(played).toEqual([]);
  });

  test('it starts herdr detached with stdio ignored', () => {
    const { finish, spawned } = completionHarness({ env: HERDR_INSIDE });
    finish(true);
    expect(spawned.map((call) => call.options)).toEqual([
      { stdio: ['ignore', 'ignore', 'ignore'], detached: true },
    ]);
  });

  test('HERDR_BIN_PATH names the binary', () => {
    const env: Herdr = { ...HERDR_INSIDE, HERDR_BIN_PATH: '/opt/herdr/bin/herdr' };
    const { finish, played, spawned } = completionHarness({ env });
    finish(true);
    expect(spawned.map((call) => call.command)).toEqual([['/opt/herdr/bin/herdr', ...HERDR_ARGS]]);
    expect(played).toEqual([]);
  });

  test('a failed spawn is swallowed and the player stays quiet', () => {
    const { finish, played, spawned } = completionHarness({ env: HERDR_INSIDE, spawnFails: true });
    finish(true);
    expect(spawned).toHaveLength(1);
    expect(played).toEqual([]);
  });

  test('a muted user hears nothing and herdr is not run', () => {
    const { finish, played, spawned } = completionHarness({
      completionSound: 'off',
      env: HERDR_INSIDE,
    });
    finish(true);
    finish(false);
    expect(spawned).toEqual([]);
    expect(played).toEqual([]);
  });

  test('a turn with no subagents runs herdr with the done sound and does not call the player', () => {
    const { finish, played, spawned } = completionHarness({ env: HERDR_INSIDE });
    finish(false);
    expect(spawned.map((call) => call.command)).toEqual([['herdr', ...HERDR_DONE_ARGS]]);
    expect(played).toEqual([]);
  });

  test('a call with no argument counts as a finished turn', () => {
    const { finish, played, spawned } = completionHarness({ env: HERDR_INSIDE });
    finish();
    expect(spawned.map((call) => call.command)).toEqual([['herdr', ...HERDR_DONE_ARGS]]);
    expect(played).toEqual([]);
  });

  test('a custom completion sound is ignored in favour of the done sound', () => {
    const { finish, played, spawned } = completionHarness({
      completionSound: 'bell',
      env: HERDR_INSIDE,
    });
    finish(false);
    expect(spawned.map((call) => call.command)).toEqual([['herdr', ...HERDR_DONE_ARGS]]);
    expect(played).toEqual([]);
  });

  test('HERDR_BIN_PATH names the binary for the done sound too', () => {
    const env: Herdr = { ...HERDR_INSIDE, HERDR_BIN_PATH: '/opt/herdr/bin/herdr' };
    const { finish, spawned } = completionHarness({ env });
    finish(false);
    expect(spawned.map((call) => call.command)).toEqual([
      ['/opt/herdr/bin/herdr', ...HERDR_DONE_ARGS],
    ]);
  });

  test('a failed spawn for the done sound is swallowed and the player stays quiet', () => {
    const { finish, played, spawned } = completionHarness({ env: HERDR_INSIDE, spawnFails: true });
    finish(false);
    expect(spawned).toHaveLength(1);
    expect(played).toEqual([]);
  });
});

describe('outside herdr the sounds still use the player', () => {
  test('without HERDR_ENV the completion sound plays and herdr is not run', () => {
    const env: Herdr = { ...HERDR_OUTSIDE, HERDR_BIN_PATH: '/opt/herdr/bin/herdr' };
    const { finish, played, spawned } = completionHarness({ env });
    finish(false);
    expect(spawned).toEqual([]);
    expect(played).toEqual([{ sound: 'fx-ok01', focus: 'always' }]);
  });

  test('without HERDR_ENV the wait wav plays and herdr is not run', () => {
    const env: Herdr = { ...HERDR_OUTSIDE, HERDR_BIN_PATH: '/opt/herdr/bin/herdr' };
    const { finish, played, spawned } = completionHarness({ env });
    finish(true);
    expect(spawned).toEqual([]);
    expect(played).toEqual([{ sound: WAIT_SOUND, focus: 'always' }]);
  });

  test('a muted user stays silent', () => {
    const { finish, played, spawned } = completionHarness({ completionSound: 'off' });
    finish(true);
    finish(false);
    expect(spawned).toEqual([]);
    expect(played).toEqual([]);
  });
});
