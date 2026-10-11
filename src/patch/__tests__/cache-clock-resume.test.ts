import { afterEach, beforeEach, describe, expect, test } from 'bun:test';

import type { Setup } from './clock-env.ts';
import { fileOf, pureClock } from './clock-env.ts';
import { FooterWorld, SESSION } from './footer-harness.ts';
import { MINUTE_MS } from './warmer-harness.ts';

const NOW = Date.UTC(2026, 9, 11, 12, 0, 0);
const TRUSTED_MS = 45 * MINUTE_MS;
const SETUP: Setup = { droid: '0.238.0', skills: 'aaa', mcp: 'ccc', 'AGENTS.md': 'bbb' };
const HELP = '? for help';

let footer: FooterWorld;

beforeEach(() => {
  footer = new FooterWorld();
  FooterWorld.at(NOW);
});

afterEach(() => {
  FooterWorld.reset();
});

function saved(ageMs: number, setup: Setup | null = SETUP): void {
  footer.clock.files.set(fileOf(SESSION), JSON.stringify({ at: NOW - ageMs, setup }));
}

async function resumed(): Promise<string> {
  footer.render();
  await Bun.sleep(0);
  return footer.text;
}

async function fingerprint(setup: Setup | null): Promise<string> {
  footer.clock.startFingerprint();
  footer.clock.answer(setup);
  await Bun.sleep(0);
  return footer.text;
}

describe('what the pure part decides', () => {
  const { $ODCd: diff, $ODCv: view } = pureClock();
  const settled = { done: true, setup: SETUP };

  test('lists the differing keys in the current setup order', () => {
    const recorded = { ...SETUP, skills: 'zzz', 'AGENTS.md': 'yyy' };

    expect(diff(recorded, SETUP)).toEqual(['skills', 'AGENTS.md']);
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
    saved(10 * MINUTE_MS);

    expect(footer.render()).toBe(HELP);
    await Bun.sleep(0);

    expect(footer.text).toBe(`[cache checking] ${HELP}`);
  });

  test('says cold at once past the trusted window, and never runs the fingerprint', async () => {
    saved(TRUSTED_MS + MINUTE_MS);

    expect(await resumed()).toBe(`[cache cold] ${HELP}`);
    expect(footer.colorOf('cache cold')).toBe('warning');
    expect(footer.pending).toHaveLength(0);
    expect(footer.clock.fingerprintTimerArmed).toBe(false);
  });

  test('says checking within the window while the fingerprint is pending', async () => {
    saved(10 * MINUTE_MS);

    expect(await resumed()).toBe(`[cache checking] ${HELP}`);
    expect(footer.colorOf('cache checking')).toBe('muted');
    expect(footer.clock.fingerprintTimerArmed).toBe(true);
  });

  test('does not run the fingerprint for a session without a file', async () => {
    await resumed();

    expect(footer.clock.fingerprintTimerArmed).toBe(false);
  });

  test('does not throw when the cache clock is not installed', () => {
    FooterWorld.reset();
    FooterWorld.at(NOW);

    expect(footer.render()).toBe(HELP);
  });

  test('counts down like a live entry when the setups match', async () => {
    saved(13 * MINUTE_MS + 1000);
    await resumed();

    expect(await fingerprint({ ...SETUP })).toBe(`[cache 31m] ${HELP}`);
    expect(footer.colorOf('cache 31m')).toBe('muted');
    expect(footer.pending.map((timer) => timer.delay)).toEqual([59 * 1000 + 1]);
    expect(footer.fireOnlyTimer()).toBe(`[cache 30m] ${HELP}`);
  });

  test('names what changed when the setups differ', async () => {
    saved(10 * MINUTE_MS, { ...SETUP, skills: 'old', 'AGENTS.md': 'old' });
    await resumed();

    expect(await fingerprint(SETUP)).toBe(`[cache cold: skills, AGENTS.md changed] ${HELP}`);
    expect(footer.colorOf('cache cold: skills, AGENTS.md changed')).toBe('warning');
  });

  test('says unchecked when this process has no fingerprint', async () => {
    saved(10 * MINUTE_MS);
    await resumed();

    footer.clock.startFingerprint();
    footer.clock.reply(new Error('spawn move-work ENOENT'), '');
    await Bun.sleep(0);

    expect(footer.text).toBe(`[cache unchecked] ${HELP}`);
    expect(footer.colorOf('cache unchecked')).toBe('warning');
  });

  test('says unchecked when the file recorded no fingerprint', async () => {
    saved(10 * MINUTE_MS, null);
    await resumed();

    expect(await fingerprint(SETUP)).toBe(`[cache unchecked] ${HELP}`);
  });

  test('goes cold on its own when the window ends while the setups match', async () => {
    saved(TRUSTED_MS - 30 * 1000);
    await resumed();
    await fingerprint(SETUP);

    expect(footer.text).toBe(`[cache <1m] ${HELP}`);
    expect(footer.fireOnlyTimer()).toBe(`[cache cold] ${HELP}`);
  });

  test('is replaced by the live entry when a request follows', async () => {
    saved(10 * MINUTE_MS, { ...SETUP, skills: 'old' });
    await resumed();
    await fingerprint(SETUP);

    footer.runtime.record(SESSION, Date.now());

    expect(footer.render()).toBe(`[cache 44m] ${HELP}`);
  });

  test('keeps the live entry when the file arrives after a request', async () => {
    saved(10 * MINUTE_MS, { ...SETUP, skills: 'old' });
    footer.render();
    footer.runtime.record(SESSION, NOW);
    await Bun.sleep(0);

    expect(footer.render()).toBe(`[cache 44m] ${HELP}`);
  });

  test('reads the file once however often the footer renders', async () => {
    saved(10 * MINUTE_MS);
    await resumed();
    footer.render();
    footer.render();
    await Bun.sleep(0);

    expect(footer.clock.reads).toEqual([fileOf(SESSION)]);
  });

  test('shows nothing for a session without a file, and logs nothing', async () => {
    expect(await resumed()).toBe(HELP);
    expect(footer.clock.logged).toHaveLength(0);
  });

  test('shows nothing for an unreadable file, and logs it', async () => {
    footer.clock.files.set(fileOf(SESSION), 'not json');

    expect(await resumed()).toBe(HELP);
    expect(footer.clock.logged.map((line) => line.message)).toEqual([
      '[ovrdroid] cache clock load failed',
    ]);
  });
});
