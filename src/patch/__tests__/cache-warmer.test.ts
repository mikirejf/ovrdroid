import { afterEach, beforeEach, describe, expect, test } from 'bun:test';

import { MAX_WARM_DELAY_MS, MIN_WARM_DELAY_MS, WARM_DELAY_ENV } from '../warmer-patches.ts';
import type { Reply } from './warmer-harness.ts';
import {
  ANTHROPIC_DELAY_MS,
  OTHER_SESSION,
  SERVICE_NAME,
  SESSION,
  snapshot,
  USAGE,
  World,
} from './warmer-harness.ts';

let world: World;

beforeEach(() => {
  world = new World();
});

afterEach(() => {
  World.close();
});

describe('arming', () => {
  test('a new request replaces the pending timer', () => {
    world.request(1);
    world.request(2);

    expect(world.cleared).toEqual(world.timers.slice(0, 1));
    expect(world.harness.warm.size).toBe(1);
  });

  test('a request keeps its snapshot for the full delay before any subagent has started', () => {
    world.request(1);

    expect(world.timers).toHaveLength(1);
    expect(world.harness.warm.get(SESSION)?.snap.capturedAt).toBe(1);
    expect(world.harness.warm.get(SESSION)?.timer.delay).toBe(ANTHROPIC_DELAY_MS);
  });

  test.each([
    ['one minute', MIN_WARM_DELAY_MS],
    ['one hour', MAX_WARM_DELAY_MS],
  ])('a delay of %s (%d ms) is used as set', (_label, delay) => {
    world.env[WARM_DELAY_ENV] = String(delay);

    world.request(1);

    expect(world.harness.warm.get(SESSION)?.timer.delay).toBe(delay);
  });

  test.each([
    '-1',
    '0',
    String(MIN_WARM_DELAY_MS - 1),
    String(MAX_WARM_DELAY_MS + 1),
    'NaN',
    '1e999',
  ])('%s is ignored and the provider default is used', (value) => {
    world.env[WARM_DELAY_ENV] = value;

    world.request(1);

    expect(world.harness.warm.get(SESSION)?.timer.delay).toBe(ANTHROPIC_DELAY_MS);
  });

  test('a subagent that starts long after the request is still warmed', async () => {
    world.request(1);
    world.children = 1;

    await world.fireCurrent();

    expect(world.sent).toHaveLength(1);
  });
});

describe('when the timer fires', () => {
  test('a snapshot pruned from the store after four minutes still warms', async () => {
    world.children = 1;
    world.request(1);
    world.harness.snapshots.delete(SESSION);

    await world.fireCurrent();

    expect(world.sent).toHaveLength(1);
  });

  test('a snapshot that is no longer the latest sends nothing', async () => {
    world.children = 2;
    world.request(1);
    world.harness.snapshots.set(SESSION, snapshot(2));

    await world.fireCurrent();

    expect(world.sent).toHaveLength(0);
    expect(world.harness.warm.has(SESSION)).toBe(false);
  });

  test('a session the user has switched away from sends nothing and does not re-arm', async () => {
    world.children = 1;
    world.request(1);
    world.current = OTHER_SESSION;

    await world.fireCurrent();

    expect(world.sent).toHaveLength(0);
    expect(world.built).toHaveLength(0);
    expect(world.timers).toHaveLength(1);
    expect(world.harness.warm.has(SESSION)).toBe(false);
  });

  test('subagents that finished in the meantime send nothing and do not re-arm', async () => {
    world.children = 1;
    world.request(1);
    world.children = 0;

    await world.fireCurrent();

    expect(world.sent).toHaveLength(0);
    expect(world.timers).toHaveLength(1);
    expect(world.harness.warm.has(SESSION)).toBe(false);
  });

  test('running subagents send one read of the prefix at the snapshot effort, log it, and re-arm', async () => {
    world.children = 1;
    world.request(1);
    const armed = world.harness.warm.get(SESSION);

    await world.fireCurrent();

    expect(world.sent).toHaveLength(1);
    expect(world.sent[0]?.maxTokensOverride).toBe(1);
    expect(world.sent[0]?.reasoningEffort).toBe('low');
    expect(world.sent[0]?.conversationHistory).toBe(armed?.snap.preparedHistory);
    expect(world.disposed).toBe(1);
    expect(world.logged).toHaveLength(1);
    expect(world.logged[0]).toMatchObject({
      s: SESSION,
      warm: true,
      ok: true,
      cr: 12_562,
      cw: 0,
    });
    expect(world.timers).toHaveLength(2);
    expect(world.harness.warm.get(SESSION)).not.toBe(armed);
    expect(world.harness.warm.get(SESSION)?.snap).toBe(armed?.snap);
    expect(world.harness.warm.get(SESSION)?.timer.delay).toBe(ANTHROPIC_DELAY_MS);
  });
});

describe('the warm client', () => {
  test('resolves tools like the agent loop, over HTTP, without retries or retry notices', async () => {
    world.children = 1;
    world.request(1);

    await world.fireCurrent();

    expect(world.built).toHaveLength(1);
    expect(world.built[0]?.deps.getTools).toBeUndefined();
    expect(world.built[0]?.deps.getRetryStrategy()).toBe('no_retry');
    expect(world.built[0]?.options.emitLlmRetryStatus).toBe(false);
    expect(world.built[0]?.options.platformOverrides.useOpenAIResponsesWebSocket()).toBe(false);
  });

  test('commits its usage to the warmed session marked as a warm', async () => {
    world.children = 1;
    world.request(1);

    await world.fireCurrent();
    world.built[0]?.deps.session.commitTurnTokenUsage({ inputTokens: 3 }, 'claude');

    expect(world.writes).toEqual([
      {
        method: 'commitTurnTokenUsage',
        sessionId: SESSION,
        args: [{ inputTokens: 3, odWarm: true }, 'claude'],
      },
    ]);
  });

  test('passes streaming usage and time to first token through while its session is current', async () => {
    world.children = 1;
    world.request(1);

    await world.fireCurrent();
    world.built[0]?.deps.session.addTokenUsage({ inputTokens: 3 }, true);
    world.built[0]?.deps.session.recordTimeToFirstToken(120);

    expect(world.writes).toEqual([
      { method: 'addTokenUsage', sessionId: SESSION, args: [{ inputTokens: 3 }, true] },
      { method: 'recordTimeToFirstToken', sessionId: SESSION, args: [120] },
    ]);
  });

  test('drops every usage write once the user has switched to another session mid-warm', async () => {
    world.children = 1;
    world.request(1);

    await world.fireCurrent();
    world.current = OTHER_SESSION;
    const session = world.built[0]?.deps.session;
    session?.commitTurnTokenUsage({ inputTokens: 3 }, 'claude');
    session?.addTokenUsage({ inputTokens: 3 }, true);
    session?.recordTimeToFirstToken(120);

    expect(world.writes).toHaveLength(0);
  });

  test('runs every other session method against the session service itself', async () => {
    world.children = 1;
    world.request(1);

    await world.fireCurrent();

    expect(world.built[0]?.deps.session.whoAmI()).toBe(SERVICE_NAME);
  });

  test('is disposed even when the send fails', async () => {
    world.children = 1;
    world.reply = Promise.reject(new Error('proxy down'));
    world.request(1);

    await world.fireCurrent();

    expect(world.disposed).toBe(1);
    expect(world.logged[0]).toMatchObject({ ok: false });
  });
});

describe('cancelling', () => {
  test('closing the session clears the pending timer', () => {
    world.request(1);

    world.harness.LV(SESSION);

    expect(world.cleared).toEqual(world.timers.slice(0, 1));
    expect(world.harness.warm.has(SESSION)).toBe(false);
  });

  test('closing the session aborts a warm in flight and it does not re-arm', async () => {
    world.children = 1;
    const pending = Promise.withResolvers<Reply>();
    world.reply = pending.promise;
    world.request(1);
    const firing = world.fireCurrent();
    await Bun.sleep(0);

    world.harness.LV(SESSION);
    pending.resolve({ wasAborted: true, usage: USAGE });
    await firing;

    expect(world.aborted).toBe(1);
    expect(world.timers).toHaveLength(1);
    expect(world.harness.warm.has(SESSION)).toBe(false);
  });

  test('a queued user message (vu) leaves the pending timer in place', () => {
    world.request(1);
    const armed = world.harness.warm.get(SESSION);

    world.harness.vu(SESSION);

    expect(world.cleared).toHaveLength(0);
    expect(world.harness.warm.get(SESSION)).toBe(armed);
  });

  test('a new request aborts a warm in flight and starts over on the new snapshot', async () => {
    world.children = 1;
    const pending = Promise.withResolvers<Reply>();
    world.reply = pending.promise;
    world.request(1);
    const firing = world.fireCurrent();
    await Bun.sleep(0);

    world.request(2);
    pending.resolve({ wasAborted: true, usage: USAGE });
    await firing;

    expect(world.aborted).toBe(1);
    expect(world.timers).toHaveLength(2);
    expect(world.harness.warm.get(SESSION)?.snap.capturedAt).toBe(2);
  });
});
