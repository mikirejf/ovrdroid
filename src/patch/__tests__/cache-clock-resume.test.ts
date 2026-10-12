import { afterEach, beforeEach, describe, expect, test } from 'bun:test';

import { fileOf, pureClock } from './clock-env.ts';
import { FooterWorld, SESSION } from './footer-harness.ts';
import { HELP, NOW, ResumeWorld, SETUP, TRUSTED_MS } from './resume-world.ts';
import { MINUTE_MS } from './warmer-harness.ts';

let footer: ResumeWorld;

beforeEach(() => {
  footer = new ResumeWorld();
});

afterEach(() => {
  FooterWorld.reset();
});

describe('what the pure part decides', () => {
  const { $ODCd: diff, $ODCv: view } = pureClock();
  const settled = { done: true, setup: SETUP };

  test('lists the differing keys in the current setup order', () => {
    const recorded = { ...SETUP, proxy: 'zzz', 'AGENTS.md': 'yyy' };

    expect(diff(recorded, SETUP)).toEqual(['proxy', 'AGENTS.md']);
  });

  test('lists a key that is gone now after the current ones', () => {
    const { mcp: _mcp, ...current } = SETUP;

    expect(diff({ ...SETUP, extra: 'x' }, current)).toEqual(['mcp', 'extra']);
  });

  test('lists a key that is new now', () => {
    const { mcp: _mcp, ...recorded } = SETUP;

    expect(diff(recorded, SETUP)).toEqual(['mcp']);
  });

  test('lists nothing for equal setups', () => {
    expect(diff({ ...SETUP }, SETUP)).toEqual([]);
  });

  test('ignores skills, droids and commands, which a resumed transcript replays', () => {
    const recorded = { ...SETUP, skills: 'old', droids: 'old', commands: 'old' };
    const current = { ...SETUP, droids: 'new', commands: 'new' };

    expect(diff(recorded, current)).toEqual([]);
    expect(diff(current, recorded)).toEqual([]);
  });

  test('lists only the keys that are not replayed when both kinds differ', () => {
    const recorded = { ...SETUP, skills: 'old', droids: 'old', proxy: 'old', mcp: 'old' };
    const current = { ...SETUP, droids: 'new', commands: 'new' };

    expect(diff(recorded, current)).toEqual(['proxy', 'mcp']);
  });

  test('says cold at once for an entry past the trusted window, whatever the setup', () => {
    const entry = { at: NOW - TRUSTED_MS, setup: null };

    expect(view(entry, NOW, { done: false, setup: null })).toEqual({
      text: 'cache cold',
      warn: true,
    });
  });

  test('says checking while this process has no fingerprint yet', () => {
    const entry = { at: NOW - MINUTE_MS, setup: SETUP };

    expect(view(entry, NOW, { done: false, setup: null })).toEqual({
      text: 'cache checking',
      warn: false,
    });
  });

  test('says unchecked when either fingerprint is missing', () => {
    const unchecked = { text: 'cache unchecked', warn: true };

    expect(view({ at: NOW, setup: null }, NOW, settled)).toEqual(unchecked);
    expect(view({ at: NOW, setup: SETUP }, NOW, { done: true, setup: null })).toEqual(unchecked);
  });

  test('names the changed parts when the setups differ', () => {
    const entry = { at: NOW, setup: { ...SETUP, mcp: 'old' } };

    expect(view(entry, NOW, settled)).toEqual({ text: 'cache cold: mcp changed', warn: true });
  });

  test('hands over to the live countdown when the setups match', () => {
    expect(view({ at: NOW, setup: { ...SETUP } }, NOW, settled)).toBeNull();
  });
});

describe('a resumed session in the footer', () => {
  test('shows nothing until its file has been read, then re-renders by itself', async () => {
    footer.saved(10 * MINUTE_MS);

    expect(footer.render()).toBe(HELP);
    await Bun.sleep(0);

    expect(footer.text).toBe(`[cache checking] ${HELP}`);
  });

  test('says cold at once past the trusted window, and never runs the fingerprint', async () => {
    footer.saved(TRUSTED_MS + MINUTE_MS);

    expect(await footer.resumed()).toBe(`[cache cold] ${HELP}`);
    expect(footer.colorOf('cache cold')).toBe('warning');
    expect(footer.pending).toHaveLength(0);
    expect(footer.clock.fingerprintTimerArmed).toBe(false);
  });

  test('says checking within the window while the fingerprint is pending', async () => {
    footer.saved(10 * MINUTE_MS);

    expect(await footer.resumed()).toBe(`[cache checking] ${HELP}`);
    expect(footer.colorOf('cache checking')).toBe('muted');
    expect(footer.clock.fingerprintTimerArmed).toBe(true);
  });

  test('does not run the fingerprint for a session without a file', async () => {
    await footer.resumed();

    expect(footer.clock.fingerprintTimerArmed).toBe(false);
  });

  test('does not throw when the cache clock is not installed', () => {
    FooterWorld.reset();
    FooterWorld.at(NOW);

    expect(footer.render()).toBe(HELP);
  });

  test('counts down like a live entry when the setups match', async () => {
    footer.saved(13 * MINUTE_MS + 1000);
    await footer.resumed();

    expect(await footer.fingerprint({ ...SETUP })).toBe(`[cache 31m] ${HELP}`);
    expect(footer.colorOf('cache 31m')).toBe('muted');
    expect(footer.pending.map((timer) => timer.delay)).toEqual([59 * 1000 + 1]);
    expect(footer.fireOnlyTimer()).toBe(`[cache 30m] ${HELP}`);
  });

  test('names what changed when the setups differ', async () => {
    footer.saved(10 * MINUTE_MS, { ...SETUP, proxy: 'old', 'AGENTS.md': 'old' });
    await footer.resumed();

    expect(await footer.fingerprint(SETUP)).toBe(`[cache cold: proxy, AGENTS.md changed] ${HELP}`);
    expect(footer.colorOf('cache cold: proxy, AGENTS.md changed')).toBe('warning');
  });

  test('counts down when only skills, droids and commands differ', async () => {
    footer.saved(13 * MINUTE_MS + 1000, {
      ...SETUP,
      skills: 'old',
      droids: 'old',
      commands: 'old',
    });
    await footer.resumed();

    expect(await footer.fingerprint({ ...SETUP, droids: 'new' })).toBe(`[cache 31m] ${HELP}`);
  });

  test('names only the keys that are not replayed when others differ too', async () => {
    footer.saved(10 * MINUTE_MS, { ...SETUP, skills: 'old', droids: 'old', mcp: 'old' });
    await footer.resumed();

    expect(await footer.fingerprint(SETUP)).toBe(`[cache cold: mcp changed] ${HELP}`);
  });

  test('says unchecked when this process has no fingerprint', async () => {
    footer.saved(10 * MINUTE_MS);
    await footer.resumed();

    footer.clock.startFingerprint();
    footer.clock.reply(new Error('spawn move-work ENOENT'), '');
    await Bun.sleep(0);

    expect(footer.text).toBe(`[cache unchecked] ${HELP}`);
    expect(footer.colorOf('cache unchecked')).toBe('warning');
  });

  test('says unchecked when the file recorded no fingerprint', async () => {
    footer.saved(10 * MINUTE_MS, null);
    await footer.resumed();

    expect(await footer.fingerprint(SETUP)).toBe(`[cache unchecked] ${HELP}`);
  });

  test('goes cold on its own when the window ends while the setups match', async () => {
    footer.saved(TRUSTED_MS - 30 * 1000);
    await footer.resumed();
    await footer.fingerprint(SETUP);

    expect(footer.text).toBe(`[cache <1m] ${HELP}`);
    expect(footer.fireOnlyTimer()).toBe(`[cache cold] ${HELP}`);
  });

  test('is replaced by the live entry when a request follows', async () => {
    footer.saved(10 * MINUTE_MS, { ...SETUP, proxy: 'old' });
    await footer.resumed();
    await footer.fingerprint(SETUP);

    footer.runtime.record(SESSION, Date.now());

    expect(footer.render()).toBe(`[cache 44m] ${HELP}`);
  });

  test('keeps the live entry when the file arrives after a request', async () => {
    footer.saved(10 * MINUTE_MS, { ...SETUP, proxy: 'old' });
    footer.render();
    footer.runtime.record(SESSION, NOW);
    await Bun.sleep(0);

    expect(footer.render()).toBe(`[cache 44m] ${HELP}`);
  });

  test('reads the file once however often the footer renders', async () => {
    footer.saved(10 * MINUTE_MS);
    await footer.resumed();
    footer.render();
    footer.render();
    await Bun.sleep(0);

    expect(footer.clock.reads).toEqual([fileOf(SESSION)]);
  });

  test('shows nothing for a session without a file, and logs nothing', async () => {
    expect(await footer.resumed()).toBe(HELP);
    expect(footer.clock.logged).toHaveLength(0);
  });

  test('shows nothing for an unreadable file, and logs it', async () => {
    footer.clock.files.set(fileOf(SESSION), 'not json');

    expect(await footer.resumed()).toBe(HELP);
    expect(footer.clock.logged.map((line) => line.message)).toEqual([
      '[ovrdroid] cache clock load failed',
    ]);
  });
});
