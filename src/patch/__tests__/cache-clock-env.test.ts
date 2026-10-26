import { expect, test } from 'bun:test';

import { CACHE_CLOCK_ENV, FINGERPRINT_DELAY_MS, FINGERPRINT_TIMEOUT_MS } from '../cache-clock.ts';
import type { ClockEnvironment, Finish, Logged } from './clock-env.ts';
import { CLOCK_DIR, ClockEnv, HOME, SESSIONS_DIR } from './clock-env.ts';
import { payloadFunction } from './payload.ts';

type ExecFileArguments = [file: string, args: string[], options: { timeout: number }, done: Finish];

interface Armed {
  start: () => void;
  delay: number;
  unrefs: number;
  outside: boolean;
}

type Bindings = [
  (name: string) => object,
  (start: () => void, delay: number) => { unref: () => void },
  (message: string, detail: Logged['detail']) => void,
  <T>(work: () => T) => T,
];

function done(): void {}

function start(): void {}

function environment() {
  const spawned: ExecFileArguments[] = [];
  const armed: Armed[] = [];
  const logged: Logged[] = [];
  const { fs } = new ClockEnv();
  let depth = 0;
  const outside = <T>(work: () => T): T => {
    depth += 1;
    try {
      return work();
    } finally {
      depth -= 1;
    }
  };
  const env = payloadFunction<Bindings, ClockEnvironment>(
    ['require', 'setTimeout', 'n', 'vo'],
    `return ${CACHE_CLOCK_ENV}`,
  )(
    (name) => {
      if (name === 'fs') {
        return fs;
      }
      if (name === 'os') {
        return { homedir: () => HOME };
      }
      if (name === 'child_process') {
        return {
          execFile: (...call: ExecFileArguments) => {
            spawned.push(call);
            return { stdin: { end: done } };
          },
        };
      }
      throw new Error(`unexpected require(${name})`);
    },
    (callback, delay) => {
      const timer = { start: callback, delay, unrefs: 0, outside: depth > 0 };
      armed.push(timer);
      return {
        unref: () => {
          timer.unrefs += 1;
        },
      };
    },
    (message, detail) => {
      logged.push({ message, detail });
    },
    outside,
  );
  return { env, fs, spawned, armed, logged };
}

test('the shipped environment keeps its files under the ovrdroid folder in the home folder', () => {
  const { env, fs } = environment();

  expect(env.dir).toBe(CLOCK_DIR);
  expect(env.fs).toBe(fs);
});

test('the shipped environment reads transcripts from the sessions folder in the home folder', () => {
  const { env } = environment();

  expect(env.sessions).toBe(SESSIONS_DIR);
});

test('the shipped environment runs a command with a timeout', () => {
  const { env, spawned } = environment();

  env.exec('move-work', ['parity'], done);

  expect(spawned).toEqual([['move-work', ['parity'], { timeout: FINGERPRINT_TIMEOUT_MS }, done]]);
});

test('the shipped environment waits before it starts and does not keep Droid alive', () => {
  const { env, armed } = environment();

  env.later(start);

  expect(armed).toEqual([{ start, delay: FINGERPRINT_DELAY_MS, unrefs: 1, outside: true }]);
});

test('the shipped environment runs work through Droid and returns its result', () => {
  const { env } = environment();

  expect(env.outside(() => 'result')).toBe('result');
});

test('the shipped environment logs through Droid', () => {
  const { env, logged } = environment();

  env.log('[ovrdroid] cache clock load failed', { sessionId: 's' });

  expect(logged).toEqual([
    { message: '[ovrdroid] cache clock load failed', detail: { sessionId: 's' } },
  ]);
});
