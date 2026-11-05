import { describe, expect, test } from 'bun:test';

import { KEEP_WARM_OFF, KEEP_WARM_ON, KEEP_WARM_USAGE } from '../keep-warm-patches.ts';
import { KeepWarmWorld, START } from './keep-warm-world.ts';
import {
  ANTHROPIC_DELAY_MS,
  keepWarm,
  OTHER_SESSION,
  SESSION,
  snapshot,
} from './warmer-harness.ts';

const kw = new KeepWarmWorld();

describe('the command', () => {
  test('with no argument it turns keep warm on, then off', () => {
    expect(keepWarm()).toBe(KEEP_WARM_ON);
    expect(keepWarm()).toBe(KEEP_WARM_OFF);
    expect(keepWarm()).toBe(KEEP_WARM_ON);
  });

  test.each([
    ['on', KEEP_WARM_ON],
    ['ON', KEEP_WARM_ON],
    ['off', KEEP_WARM_OFF],
    ['Off', KEEP_WARM_OFF],
  ])('%s sets it and says so', (argument, message) => {
    expect(keepWarm(argument)).toBe(message);
  });

  test('on and off are idempotent', () => {
    expect(keepWarm('on')).toBe(KEEP_WARM_ON);
    expect(keepWarm('on')).toBe(KEEP_WARM_ON);
    expect(keepWarm('off')).toBe(KEEP_WARM_OFF);
    expect(keepWarm('off')).toBe(KEEP_WARM_OFF);
  });

  test.each(['bogus', '1', ''])('%j changes nothing and says how to use it', (argument) => {
    keepWarm('on');

    expect(keepWarm(argument)).toBe(KEEP_WARM_USAGE);
    expect(keepWarm()).toBe(KEEP_WARM_OFF);
  });

  test('the usage line names the command and its two words', () => {
    expect(KEEP_WARM_USAGE).toBe('Usage: /keep-warm [on|off]');
  });
});

describe('a fire with no subagents', () => {
  test('with keep warm never set it sends nothing and the chain ends', async () => {
    kw.world.request(START);

    await kw.world.fireCurrent();

    expect(kw.world.sent).toHaveLength(0);
    expect(kw.world.timers).toHaveLength(1);
    expect(kw.world.harness.warm.has(SESSION)).toBe(false);
  });

  test('with keep warm on it sends one read of the prefix and re-arms', async () => {
    keepWarm('on');
    kw.world.request(START);
    const armed = kw.world.harness.warm.get(SESSION);

    await kw.world.fireCurrent();

    expect(kw.world.sent).toHaveLength(1);
    expect(kw.world.sent[0]?.maxTokensOverride).toBe(1);
    expect(kw.world.sent[0]?.conversationHistory).toBe(armed?.snap.preparedHistory);
    expect(kw.world.logged).toMatchObject([{ s: SESSION, warm: true, ok: true }]);
    expect(kw.world.timers).toHaveLength(2);
    expect(kw.world.harness.warm.get(SESSION)).not.toBe(armed);
    expect(kw.pendingDelay()).toBe(ANTHROPIC_DELAY_MS);
  });

  test('with keep warm on it keeps warming on every fire', async () => {
    keepWarm('on');
    kw.world.request(START);

    await kw.world.fireCurrent();
    await kw.world.fireCurrent();
    await kw.world.fireCurrent();

    expect(kw.world.sent).toHaveLength(3);
    expect(kw.world.timers).toHaveLength(4);
  });

  test('with keep warm on and subagents running it still sends only one warm', async () => {
    keepWarm('on');
    kw.world.children = 2;
    kw.world.request(START);

    await kw.world.fireCurrent();

    expect(kw.world.sent).toHaveLength(1);
  });

  test('with keep warm on, a snapshot that is no longer the latest sends nothing', async () => {
    keepWarm('on');
    kw.world.request(START);
    kw.world.harness.snapshots.set(SESSION, {
      snapshot: snapshot(START + 1),
      capturedBy: new WeakRef(kw.world.host),
    });

    await kw.world.fireCurrent();

    expect(kw.world.sent).toHaveLength(0);
    expect(kw.world.harness.warm.has(SESSION)).toBe(false);
  });

  test('with keep warm on, a pruned snapshot still warms', async () => {
    keepWarm('on');
    kw.world.request(START);
    kw.world.harness.snapshots.delete(SESSION);

    await kw.world.fireCurrent();

    expect(kw.world.sent).toHaveLength(1);
  });

  test('with keep warm on, a session the user has switched away from sends nothing and ends the chain', async () => {
    keepWarm('on');
    kw.world.request(START);
    kw.world.current = OTHER_SESSION;

    await kw.world.fireCurrent();

    expect(kw.world.sent).toHaveLength(0);
    expect(kw.world.built).toHaveLength(0);
    expect(kw.world.harness.warm.has(SESSION)).toBe(false);
  });

  test('turning it off makes the next fire send nothing', async () => {
    keepWarm('on');
    kw.world.request(START);
    await kw.world.fireCurrent();
    keepWarm('off');

    await kw.world.fireCurrent();

    expect(kw.world.sent).toHaveLength(1);
    expect(kw.world.harness.warm.has(SESSION)).toBe(false);
  });

  test('turning it off leaves the pending timer in place', () => {
    keepWarm('on');
    kw.world.request(START);
    const armed = kw.world.harness.warm.get(SESSION);

    keepWarm('off');

    expect(kw.world.cleared).toHaveLength(0);
    expect(kw.world.harness.warm.get(SESSION)).toBe(armed);
  });

  test('turned off, running subagents still get their warm', async () => {
    keepWarm('on');
    keepWarm('off');
    kw.world.children = 1;
    kw.world.request(START);

    await kw.world.fireCurrent();

    expect(kw.world.sent).toHaveLength(1);
    expect(kw.pendingDelay()).toBe(ANTHROPIC_DELAY_MS);
  });
});
