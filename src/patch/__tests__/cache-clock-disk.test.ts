import { afterEach, beforeEach, describe, expect, setSystemTime, test } from 'bun:test';

import {
  CACHE_CLOCK_KEEP_MS,
  FINGERPRINT_ARGS,
  FINGERPRINT_COMMAND,
  FINGERPRINT_INPUT,
} from '../cache-clock.ts';
import type { Setup } from './clock-env.ts';
import { CLOCK_DIR, fileOf } from './clock-env.ts';
import { MINUTE_MS, SESSION, World } from './warmer-harness.ts';

const SENT_AT = 1_000_000;
const WARM_TIME = SENT_AT + 45 * MINUTE_MS;
const SETUP: Setup = { droid: '0.238.0', skills: 'aaa', 'AGENTS.md': 'bbb' };

let world: World;

beforeEach(() => {
  world = new World();
});

afterEach(() => {
  setSystemTime();
  World.close();
});

async function settled(setup: Setup | null = SETUP): Promise<void> {
  world.clock.startFingerprint();
  world.clock.answer(setup);
  await Bun.sleep(0);
}

function recorded(sessionId = SESSION): string | undefined {
  return world.clock.files.get(fileOf(sessionId));
}

function file(at: number, setup: Setup | null): string {
  return JSON.stringify({ at, setup });
}

describe('the setup fingerprint', () => {
  test('waits for its timer, so nothing runs while Droid starts', async () => {
    world.request(SENT_AT);
    await Bun.sleep(0);

    expect(world.clock.fingerprintTimerArmed).toBe(true);
    expect(world.clock.fingerprintStarted).toBe(false);
  });

  test('does not start in a process that never needs it', async () => {
    world.provider = 'openai';
    world.request(SENT_AT);
    await Bun.sleep(0);

    expect(world.clock.fingerprintTimerArmed).toBe(false);
  });

  test('asks move-work for the setup with an empty object on stdin', () => {
    world.request(SENT_AT);
    world.clock.startFingerprint();

    const [call, ...rest] = world.clock.calls;
    expect(rest).toHaveLength(0);
    expect(call?.file).toBe(FINGERPRINT_COMMAND);
    expect(call?.args).toEqual(FINGERPRINT_ARGS);
    expect(call?.input).toEqual([FINGERPRINT_INPUT]);
  });

  test('runs once however many requests follow', async () => {
    world.request(SENT_AT);
    world.request(SENT_AT + MINUTE_MS);
    await settled();
    world.request(SENT_AT + 2 * MINUTE_MS);
    await Bun.sleep(0);

    expect(world.clock.calls).toHaveLength(1);
  });
});

describe('a request on disk', () => {
  test('is written with the setup once the fingerprint settles', async () => {
    world.request(SENT_AT);
    await settled();

    expect(recorded()).toBe(file(SENT_AT, SETUP));
    expect(world.clock.directories).toEqual([CLOCK_DIR]);
  });

  test('is not written before the fingerprint settles', async () => {
    world.request(SENT_AT);
    world.clock.startFingerprint();
    await Bun.sleep(0);

    expect(world.clock.files.size).toBe(0);
  });

  test('keeps the newest time when two requests wait for the fingerprint', async () => {
    world.request(SENT_AT);
    world.request(SENT_AT + MINUTE_MS);
    await settled();

    expect(recorded()).toBe(file(SENT_AT + MINUTE_MS, SETUP));
  });

  test('is overwritten by the next request', async () => {
    world.request(SENT_AT);
    await settled();

    world.request(SENT_AT + 5 * MINUTE_MS);
    await Bun.sleep(0);

    expect(recorded()).toBe(file(SENT_AT + 5 * MINUTE_MS, SETUP));
  });

  test('is overwritten by a successful warm, at the time the warm was sent', async () => {
    world.children = 1;
    setSystemTime(new Date(WARM_TIME));
    world.request(SENT_AT);
    await settled();

    await world.fireCurrent();
    await Bun.sleep(0);

    expect(recorded()).toBe(file(WARM_TIME, SETUP));
  });

  test('keeps a null setup when move-work fails', async () => {
    world.request(SENT_AT);
    world.clock.startFingerprint();
    world.clock.reply(new Error('spawn move-work ENOENT'), '');
    await Bun.sleep(0);

    expect(recorded()).toBe(file(SENT_AT, null));
    expect(world.clock.logged.map((line) => line.message)).toEqual([
      '[ovrdroid] cache setup fingerprint failed',
    ]);
  });

  test.each([
    ['output that is not JSON', 'not json'],
    ['JSON without a setup object', '{"home":"/home/test"}'],
    ['a setup that is not an object', '{"setup":"x"}'],
  ])('keeps a null setup for %s', async (_label, stdout) => {
    world.request(SENT_AT);
    world.clock.startFingerprint();
    world.clock.reply(null, stdout);
    await Bun.sleep(0);

    expect(recorded()).toBe(file(SENT_AT, null));
    expect(world.clock.logged).toHaveLength(1);
  });

  test('logs a failed write and does not throw', async () => {
    world.clock.writeFailure = new Error('disk full');
    world.request(SENT_AT);
    await settled();

    expect(world.clock.logged).toHaveLength(1);
    expect(world.clock.logged[0]?.message).toBe('[ovrdroid] cache clock write failed');
    expect(world.clock.logged[0]?.detail.sessionId).toBe(SESSION);
  });
});

describe('old files', () => {
  test('are deleted after a day, once the fingerprint runs', async () => {
    setSystemTime(new Date(SENT_AT));
    const old = fileOf('old-session');
    const recent = fileOf('recent-session');
    world.clock.files.set(old, file(0, SETUP));
    world.clock.modified.set(old, SENT_AT - CACHE_CLOCK_KEEP_MS - 1);
    world.clock.files.set(recent, file(0, SETUP));
    world.clock.modified.set(recent, SENT_AT - CACHE_CLOCK_KEEP_MS + MINUTE_MS);

    world.request(SENT_AT);
    await settled();
    await Bun.sleep(0);

    expect(world.clock.unlinked).toEqual([old]);
    expect([...world.clock.files.keys()].toSorted()).toEqual([recent, fileOf(SESSION)].toSorted());
    expect(world.clock.logged).toHaveLength(0);
  });

  test('do not need a folder to exist yet', async () => {
    world.request(SENT_AT);
    await settled();

    expect(world.clock.logged).toHaveLength(0);
  });
});

describe('a session that leaves Anthropic', () => {
  test('loses its file', async () => {
    world.request(SENT_AT);
    await settled();

    world.provider = 'openai';
    world.request(SENT_AT + MINUTE_MS);
    await Bun.sleep(0);

    expect(recorded()).toBeUndefined();
    expect(world.clock.unlinked).toEqual([fileOf(SESSION)]);
  });

  test('is not written while the fingerprint is still pending', async () => {
    world.request(SENT_AT);
    world.provider = 'openai';
    world.request(SENT_AT + MINUTE_MS);
    await settled();

    expect(recorded()).toBeUndefined();
  });

  test('has its file removed once, not on every request', async () => {
    world.provider = 'openai';
    world.request(SENT_AT);
    world.request(SENT_AT + MINUTE_MS);
    world.request(SENT_AT + 2 * MINUTE_MS);
    await Bun.sleep(0);

    expect(world.clock.unlinked).toHaveLength(1);
    expect(world.clock.logged).toHaveLength(0);
  });

  test('gets a file again when it returns to Anthropic', async () => {
    world.provider = 'openai';
    world.request(SENT_AT);
    await Bun.sleep(0);

    world.provider = 'anthropic';
    world.request(SENT_AT + MINUTE_MS);
    await settled();

    expect(recorded()).toBe(file(SENT_AT + MINUTE_MS, SETUP));
  });
});
