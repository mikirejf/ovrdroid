import { afterEach, beforeEach, describe, expect, test } from 'bun:test';

import { ClockEnv } from './clock-env.ts';
import type { ClockRuntime } from './clock-env.ts';

const SESSION = 'session-a';
const SETUP = { droid: '0.248.0' };
const HOUR_MS = 60 * 60_000;

let env: ClockEnv;
let runtime: ClockRuntime;
let insideOutside: boolean[];

beforeEach(() => {
  env = new ClockEnv();
  runtime = env.runtime();
  insideOutside = [];
  runtime.listen(() => {
    insideOutside.push(env.outsideDepth > 0);
  });
});

afterEach(() => {
  ClockEnv.close();
});

describe('a clock listener', () => {
  test('is called outside any agent scope when the setup fingerprint settles', async () => {
    runtime.record(SESSION, Date.now());
    await Bun.sleep(0);

    env.startFingerprint();
    env.answer(SETUP);
    await Bun.sleep(0);

    expect(insideOutside).toEqual([true]);
  });

  test('is called outside any agent scope when a failed fingerprint settles', async () => {
    runtime.record(SESSION, Date.now());
    await Bun.sleep(0);

    env.startFingerprint();
    env.reply(new Error('boom'), '');
    await Bun.sleep(0);

    expect(insideOutside).toEqual([true]);
  });

  test('is called outside any agent scope when a recorded session loads', async () => {
    env.files.set(
      `${env.environment().dir}/${SESSION}.json`,
      JSON.stringify({ at: Date.now() - HOUR_MS }),
    );

    runtime.load(SESSION);
    await Bun.sleep(0);
    await Bun.sleep(0);

    expect(insideOutside).toEqual([true]);
  });
});
