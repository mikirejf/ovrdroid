import { afterEach, beforeEach, describe, expect, setSystemTime, test } from 'bun:test';

import type { Reply } from './warmer-harness.ts';
import { cacheClockAt, MINUTE_MS, SESSION, USAGE, World } from './warmer-harness.ts';

const SENT_AT = 1_000_000;
const WARM_TIME = SENT_AT + 45 * MINUTE_MS;

let world: World;

beforeEach(() => {
  world = new World();
  world.children = 1;
  setSystemTime(new Date(WARM_TIME));
});

afterEach(() => {
  setSystemTime();
  World.close();
});

describe('a request', () => {
  test('starts the clock at the moment it was captured, on Anthropic', () => {
    world.request(SENT_AT);

    expect(cacheClockAt()).toBe(SENT_AT);
  });

  test('restarts the clock on the next request', () => {
    world.request(SENT_AT);
    world.request(SENT_AT + MINUTE_MS);

    expect(cacheClockAt()).toBe(SENT_AT + MINUTE_MS);
  });

  test('removes the entry when the model is not Anthropic', () => {
    world.request(SENT_AT);
    world.provider = 'openai';

    world.request(SENT_AT + MINUTE_MS);

    expect(cacheClockAt()).toBeUndefined();
  });

  test('gives another provider no entry to begin with', () => {
    world.provider = 'openai';

    world.request(SENT_AT);

    expect(cacheClockAt()).toBeUndefined();
  });
});

describe('a warm', () => {
  test('restarts the clock at the moment it was sent when it succeeds', async () => {
    world.request(SENT_AT);

    await world.fireCurrent();

    expect(world.sent).toHaveLength(1);
    expect(cacheClockAt()).toBe(WARM_TIME);
  });

  test('uses the time it was sent, not the time its reply arrived', async () => {
    const pending = Promise.withResolvers<Reply>();
    world.reply = pending.promise;
    world.request(SENT_AT);

    const firing = world.fireCurrent();
    await Bun.sleep(0);
    setSystemTime(new Date(WARM_TIME + 3 * MINUTE_MS));
    pending.resolve({ wasAborted: false, usage: USAGE });
    await firing;

    expect(cacheClockAt()).toBe(WARM_TIME);
  });

  test('leaves the clock alone when it fails', async () => {
    world.reply = Promise.reject(new Error('proxy down'));
    world.request(SENT_AT);

    await world.fireCurrent();

    expect(cacheClockAt()).toBe(SENT_AT);
  });

  test('leaves the clock alone when it was aborted', async () => {
    world.reply = Promise.resolve({ wasAborted: true, usage: USAGE });
    world.request(SENT_AT);

    await world.fireCurrent();

    expect(cacheClockAt()).toBe(SENT_AT);
  });

  test('gives another provider no entry', async () => {
    world.provider = 'openai';
    world.request(SENT_AT);

    await world.fireCurrent();

    expect(world.sent).toHaveLength(1);
    expect(cacheClockAt()).toBeUndefined();
  });

  test('does not touch another session', async () => {
    world.request(SENT_AT);

    await world.fireCurrent();

    expect(cacheClockAt(`${SESSION}-other`)).toBeUndefined();
  });
});
