import { describe, expect, test } from 'bun:test';

import { KEEP_WARM_ON } from '../keep-warm-patches.ts';
import { KeepWarmWorld, later, START } from './keep-warm-world.ts';
import {
  ANTHROPIC_DELAY_MS,
  keepWarm,
  MINUTE_MS,
  OTHER_SESSION,
  SESSION,
} from './warmer-harness.ts';

const kw = new KeepWarmWorld();

describe('turning it on after the chain ended', () => {
  const endChain = async (): Promise<void> => {
    kw.world.request(START);
    await kw.world.fireCurrent();
    expect(kw.world.harness.warm.has(SESSION)).toBe(false);
  };

  test('re-arms for what is left of the delay since the last request', async () => {
    await endChain();
    later(10);

    keepWarm('on');

    expect(kw.world.timers).toHaveLength(2);
    expect(kw.pendingDelay()).toBe(ANTHROPIC_DELAY_MS - 10 * MINUTE_MS);
    expect(kw.world.harness.warm.get(SESSION)?.snap.capturedAt).toBe(START);
  });

  test('fires right away when the moment has passed', async () => {
    await endChain();
    later(46);

    keepWarm('on');

    expect(kw.pendingDelay()).toBe(0);
  });

  test('fires right away at exactly the delay', async () => {
    await endChain();
    later(45);

    keepWarm('on');

    expect(kw.pendingDelay()).toBe(0);
  });

  test('the re-armed timer warms when it fires', async () => {
    await endChain();
    later(10);
    keepWarm('on');

    await kw.world.fireCurrent();

    expect(kw.world.sent).toHaveLength(1);
    expect(kw.pendingDelay()).toBe(ANTHROPIC_DELAY_MS);
  });

  test('counts from the last successful warm, not the request', async () => {
    keepWarm('on');
    kw.world.request(START);
    later(45);
    await kw.world.fireCurrent();
    kw.world.current = OTHER_SESSION;
    later(50);
    await kw.world.fireCurrent();
    kw.world.current = SESSION;
    later(60);

    keepWarm('on');

    expect(kw.world.harness.warm.has(SESSION)).toBe(true);
    expect(kw.pendingDelay()).toBe(30 * MINUTE_MS);
  });

  test('a failed warm does not move the last refresh time', async () => {
    keepWarm('on');
    kw.world.reply = Promise.reject(new Error('proxy down'));
    kw.world.request(START);
    later(45);
    await kw.world.fireCurrent();
    kw.world.current = OTHER_SESSION;
    later(50);
    await kw.world.fireCurrent();
    kw.world.current = SESSION;
    later(52);

    keepWarm('on');

    expect(kw.pendingDelay()).toBe(0);
  });

  test('on again after switching away and back re-arms the ended chain', async () => {
    keepWarm('on');
    kw.world.request(START);
    kw.world.current = OTHER_SESSION;
    await kw.world.fireCurrent();
    kw.world.current = SESSION;
    later(5);

    expect(keepWarm('on')).toBe(KEEP_WARM_ON);

    expect(kw.pendingDelay()).toBe(ANTHROPIC_DELAY_MS - 5 * MINUTE_MS);
  });

  test('with no request yet it only sets the flag, and the first request arms as usual', async () => {
    keepWarm('on');

    expect(kw.world.timers).toHaveLength(0);

    kw.world.request(START);
    expect(kw.pendingDelay()).toBe(ANTHROPIC_DELAY_MS);
    await kw.world.fireCurrent();

    expect(kw.world.sent).toHaveLength(1);
  });

  test('while a timer is pending it changes nothing about the timer', () => {
    kw.world.request(START);
    const armed = kw.world.harness.warm.get(SESSION);
    later(10);

    keepWarm('on');

    expect(kw.world.timers).toHaveLength(1);
    expect(kw.world.cleared).toHaveLength(0);
    expect(kw.world.harness.warm.get(SESSION)).toBe(armed);
    expect(kw.pendingDelay()).toBe(ANTHROPIC_DELAY_MS);
  });

  test('turning it off does not arm anything', async () => {
    await endChain();

    keepWarm('off');

    expect(kw.world.timers).toHaveLength(1);
    expect(kw.world.harness.warm.has(SESSION)).toBe(false);
  });

  test('a new request replaces the re-armed timer as usual', async () => {
    await endChain();
    keepWarm('on');

    kw.world.request(START + 1);

    expect(kw.world.harness.warm.get(SESSION)?.snap.capturedAt).toBe(START + 1);
    expect(kw.pendingDelay()).toBe(ANTHROPIC_DELAY_MS);
  });
});

describe('sessions', () => {
  test('keep warm for one session does not warm another', async () => {
    kw.world.current = OTHER_SESSION;
    keepWarm('on');
    kw.world.current = SESSION;
    kw.world.request(START);

    await kw.world.fireCurrent();

    expect(kw.world.sent).toHaveLength(0);
    expect(kw.world.harness.warm.has(SESSION)).toBe(false);
  });

  test('the toggle only reads and writes the current session', async () => {
    keepWarm('on');
    kw.world.current = OTHER_SESSION;
    expect(keepWarm()).toBe(KEEP_WARM_ON);
    kw.world.request(START, OTHER_SESSION);
    kw.world.current = SESSION;
    keepWarm('off');
    kw.world.request(START);
    kw.world.current = OTHER_SESSION;

    await kw.world.fireSession(OTHER_SESSION);
    await kw.world.fireSession(SESSION);

    expect(kw.world.sent).toHaveLength(1);
    expect(kw.world.logged).toMatchObject([{ s: OTHER_SESSION }]);
  });

  test('turning it on re-arms only the current session', async () => {
    kw.world.request(START);
    kw.world.request(START, OTHER_SESSION);
    await kw.world.fireCurrent();
    await kw.world.fireSession(OTHER_SESSION);

    keepWarm('on');

    expect(kw.world.harness.warm.has(SESSION)).toBe(true);
    expect(kw.world.harness.warm.has(OTHER_SESSION)).toBe(false);
  });

  test('closing the session turns it off', async () => {
    keepWarm('on');
    kw.world.request(START);
    kw.world.harness.LV(SESSION);

    kw.world.request(START + 1);
    await kw.world.fireCurrent();

    expect(kw.world.sent).toHaveLength(0);
    expect(keepWarm()).toBe(KEEP_WARM_ON);
  });

  test('closing the session forgets the snapshot to re-arm from', async () => {
    kw.world.request(START);
    await kw.world.fireCurrent();
    kw.world.harness.LV(SESSION);

    keepWarm('on');

    expect(kw.world.harness.warm.has(SESSION)).toBe(false);
  });

  test('closing another session leaves this one on', async () => {
    keepWarm('on');
    kw.world.harness.LV(OTHER_SESSION);
    kw.world.request(START);

    await kw.world.fireCurrent();

    expect(kw.world.sent).toHaveLength(1);
  });

  test('forgetting the snapshot drops the snapshot to re-arm from but keeps the flag', async () => {
    keepWarm('on');
    kw.world.request(START);
    kw.world.harness.mY(SESSION);

    keepWarm('on');
    expect(kw.world.harness.warm.has(SESSION)).toBe(false);

    kw.world.request(START + 1);
    await kw.world.fireCurrent();

    expect(kw.world.sent).toHaveLength(1);
  });

  test('another host disposing leaves the snapshot to re-arm from', async () => {
    kw.world.request(START);
    kw.world.current = OTHER_SESSION;
    await kw.world.fireCurrent();
    kw.world.current = SESSION;

    kw.world.harness.nY(SESSION, { name: 'other host' });
    keepWarm('on');

    expect(kw.world.harness.warm.has(SESSION)).toBe(true);
  });
});
