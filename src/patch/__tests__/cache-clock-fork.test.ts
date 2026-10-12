import { afterEach, beforeEach, describe, expect, test } from 'bun:test';

import { fileOf, transcriptOf } from './clock-env.ts';
import { FooterWorld, SESSION } from './footer-harness.ts';
import {
  GRANDPARENT,
  HELP,
  NOW,
  PARENT,
  ResumeWorld,
  SETUP,
  TOMBSTONE,
  transcriptText,
  TRUSTED_MS,
} from './resume-world.ts';
import { MINUTE_MS } from './warmer-harness.ts';

let footer: ResumeWorld;

beforeEach(() => {
  footer = new ResumeWorld();
});

afterEach(() => {
  FooterWorld.reset();
});

describe('a forked or rewound session in the footer', () => {
  test('inherits the parent setup and counts from the fork last message when that is older', async () => {
    footer.saveFor(PARENT, 10 * MINUTE_MS, { ...SETUP, proxy: 'old' });
    footer.transcript(SESSION, PARENT, [20 * MINUTE_MS, 15 * MINUTE_MS - 1000]);

    expect(await footer.resumed()).toBe(`[cache checking] ${HELP}`);
    expect(await footer.fingerprint({ ...SETUP, proxy: 'old' })).toBe(`[cache 30m] ${HELP}`);
    expect(footer.clock.files.has(fileOf(SESSION))).toBe(false);
  });

  test('names what changed against the setup the parent recorded', async () => {
    footer.saveFor(PARENT, 10 * MINUTE_MS, { ...SETUP, proxy: 'old' });
    footer.transcript(SESSION, PARENT, [12 * MINUTE_MS]);
    await footer.resumed();

    expect(await footer.fingerprint(SETUP)).toBe(`[cache cold: proxy changed] ${HELP}`);
  });

  test('counts from the parent request when the fork last message is newer', async () => {
    footer.saveFor(PARENT, 10 * MINUTE_MS - 1000);
    footer.transcript(SESSION, PARENT, [2 * MINUTE_MS]);
    await footer.resumed();

    expect(await footer.fingerprint(SETUP)).toBe(`[cache 35m] ${HELP}`);
  });

  test('counts from the parent request when the fork has no timestamp', async () => {
    footer.saveFor(PARENT, 10 * MINUTE_MS - 1000);
    footer.transcript(SESSION, PARENT, []);
    await footer.resumed();

    expect(await footer.fingerprint(SETUP)).toBe(`[cache 35m] ${HELP}`);
  });

  test('says cold at once when the fork last message is past the trusted window', async () => {
    footer.saveFor(PARENT, 10 * MINUTE_MS);
    footer.transcript(SESSION, PARENT, [TRUSTED_MS + MINUTE_MS]);

    expect(await footer.resumed()).toBe(`[cache cold] ${HELP}`);
    expect(footer.clock.fingerprintTimerArmed).toBe(false);
  });

  test('finds the grandparent when the parent never sent a request', async () => {
    footer.saveFor(GRANDPARENT, 10 * MINUTE_MS - 1000);
    footer.clock.files.set(
      transcriptOf(PARENT, 'elsewhere'),
      transcriptText(PARENT, GRANDPARENT, [12 * MINUTE_MS]),
    );
    footer.transcript(SESSION, PARENT, [5 * MINUTE_MS]);
    await footer.resumed();

    expect(await footer.fingerprint(SETUP)).toBe(`[cache 35m] ${HELP}`);
  });

  test('shows nothing and logs nothing when no ancestor has a file', async () => {
    footer.transcript(PARENT, GRANDPARENT, [11 * MINUTE_MS]);
    footer.transcript(GRANDPARENT, undefined, [12 * MINUTE_MS]);
    footer.transcript(SESSION, PARENT, [11 * MINUTE_MS]);

    expect(await footer.resumed()).toBe(HELP);
    expect(footer.clock.logged).toHaveLength(0);
    expect(footer.clock.fingerprintTimerArmed).toBe(false);
  });

  test('shows nothing and logs nothing when the parent transcript is gone', async () => {
    footer.transcript(SESSION, PARENT, [11 * MINUTE_MS]);

    expect(await footer.resumed()).toBe(HELP);
    expect(footer.clock.logged).toHaveLength(0);
  });

  test('shows nothing and logs nothing for a session that is not a fork', async () => {
    footer.transcript(SESSION, undefined, [11 * MINUTE_MS]);

    expect(await footer.resumed()).toBe(HELP);
    expect(footer.clock.logged).toHaveLength(0);
  });

  test('shows nothing and logs nothing for a session without a transcript', async () => {
    footer.saveFor(PARENT, 10 * MINUTE_MS);

    expect(await footer.resumed()).toBe(HELP);
    expect(footer.clock.logged).toHaveLength(0);
  });

  test('keeps the live entry when a request arrives before the transcript is read', async () => {
    footer.saveFor(PARENT, 10 * MINUTE_MS, { ...SETUP, proxy: 'old' });
    footer.transcript(SESSION, PARENT, [11 * MINUTE_MS]);
    footer.render();
    footer.runtime.record(SESSION, NOW);
    await Bun.sleep(0);

    expect(footer.render()).toBe(`[cache 44m] ${HELP}`);
  });

  test('ignores resume hook records that never reach the model', async () => {
    footer.saveFor(PARENT, 10 * MINUTE_MS);
    footer.transcript(SESSION, PARENT, [51 * MINUTE_MS]);
    footer.appendHookRecord(SESSION, 2 * MINUTE_MS);

    expect(await footer.resumed()).toBe(`[cache cold] ${HELP}`);
  });

  test('counts from a message after which only hook records follow', async () => {
    footer.saveFor(PARENT, 10 * MINUTE_MS);
    footer.transcript(SESSION, PARENT, [15 * MINUTE_MS - 1000]);
    footer.appendHookRecord(SESSION, 3 * MINUTE_MS);
    footer.appendHookRecord(SESSION, 2 * MINUTE_MS);
    await footer.resumed();

    expect(await footer.fingerprint(SETUP)).toBe(`[cache 30m] ${HELP}`);
  });

  test('shows nothing for a fork whose own file is a tombstone', async () => {
    footer.saveFor(PARENT, 10 * MINUTE_MS);
    footer.transcript(SESSION, PARENT, [11 * MINUTE_MS]);
    footer.clock.files.set(fileOf(SESSION), TOMBSTONE);

    expect(await footer.resumed()).toBe(HELP);
    expect(footer.clock.logged).toHaveLength(0);
    expect(footer.clock.reads).toEqual([fileOf(SESSION)]);
    expect(footer.clock.fingerprintTimerArmed).toBe(false);
  });

  test('shows nothing after a restart for a fork that left Anthropic', async () => {
    footer.saveFor(PARENT, 10 * MINUTE_MS);
    footer.transcript(SESSION, PARENT, [11 * MINUTE_MS]);
    footer.runtime.forget(SESSION);
    await Bun.sleep(0);
    const { files } = footer.clock;

    FooterWorld.reset();
    footer = new ResumeWorld();
    for (const [name, text] of files) {
      footer.clock.files.set(name, text);
    }

    expect(await footer.resumed()).toBe(HELP);
    expect(footer.clock.logged).toHaveLength(0);
  });

  test('stops at an ancestor tombstone instead of walking on', async () => {
    footer.saveFor(GRANDPARENT, 10 * MINUTE_MS);
    footer.clock.files.set(fileOf(PARENT), TOMBSTONE);
    footer.transcript(PARENT, GRANDPARENT, [11 * MINUTE_MS]);
    footer.transcript(SESSION, PARENT, [11 * MINUTE_MS]);

    expect(await footer.resumed()).toBe(HELP);
    expect(footer.clock.logged).toHaveLength(0);
    expect(footer.clock.fingerprintTimerArmed).toBe(false);
  });

  test('logs a file whose timestamp is neither a number nor null', async () => {
    footer.clock.files.set(fileOf(SESSION), '{"at":"soon"}');

    expect(await footer.resumed()).toBe(HELP);
    expect(footer.clock.logged.map((line) => line.message)).toEqual([
      '[ovrdroid] cache clock load failed',
    ]);
  });

  test('logs a transcript whose first line is not JSON', async () => {
    footer.clock.files.set(transcriptOf(SESSION), 'not json\n');

    expect(await footer.resumed()).toBe(HELP);
    expect(footer.clock.logged.map((line) => line.message)).toEqual([
      '[ovrdroid] cache clock load failed',
    ]);
    expect(footer.clock.logged[0]?.detail.sessionId).toBe(SESSION);
  });
});
