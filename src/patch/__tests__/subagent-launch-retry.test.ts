import { describe, expect, test } from 'bun:test';

import { failureOf } from './payload.ts';
import { GPT, launchTools, LaunchCancelledError } from './subagent-launch-tools-harness.ts';

const UNRESOLVED = { resolved: [], errors: ['Tool Task cannot be enabled.'] };

describe('the launch keeps stock saved-tool validation and startup retry', () => {
  test('waits for startup, retries for the picked model, then applies readonly', async () => {
    const startup = Promise.withResolvers<null>();
    const waiting = Promise.withResolvers<null>();
    const controller = new AbortController();
    const events: string[] = [];
    const launch = launchTools(true, ['Read', 'Edit'], {
      picked: { modelId: GPT, $ODtoolModel: GPT },
      selections: [UNRESOLVED, { resolved: ['Read', 'Edit', 'TodoWrite'], errors: [] }],
      events,
      startup: async () => {
        await startup.promise;
      },
      abortSignal: controller.signal,
      wait: async (promise, signal) => {
        expect(signal).toBe(controller.signal);
        events.push('wait');
        waiting.resolve(null);
        await promise;
      },
    });
    await waiting.promise;
    expect(events).toEqual(['pick', `expand:${GPT}`, 'wait']);
    startup.resolve(null);
    const result = await launch;
    expect(result.tools).toEqual(['Read', 'TodoWrite']);
    expect(result.restricted).toBe(true);
    expect(events).toEqual(['pick', `expand:${GPT}`, 'wait', `expand:${GPT}`, `expand:${GPT}`]);
  });

  test('returns both stock error messages when the retry still cannot resolve the tools', async () => {
    const events: string[] = [];
    const error = await failureOf(
      launchTools(undefined, ['Task'], {
        selections: [UNRESOLVED, UNRESOLVED],
        events,
        startup: async () => {
          await Promise.resolve();
        },
      }),
    );
    expect(error).toBe(
      'Droid probe cannot run because its saved tools selection does not resolve: Tool Task cannot be enabled.\n' +
        'Droid "probe" cannot run: Tool Task cannot be enabled.',
    );
    expect(events).toEqual(['pick', 'expand:inherit', 'expand:inherit']);
  });

  test('without a startup service it refuses unresolved tools without retrying', async () => {
    const events: string[] = [];
    const error = await failureOf(
      launchTools(undefined, undefined, { selections: [UNRESOLVED], events }),
    );
    expect(error).toContain('saved tools selection does not resolve');
    expect(events).toEqual(['pick', 'expand:inherit']);
  });

  test('a failed startup wait throws the stock cancellation error without retrying', async () => {
    const events: string[] = [];
    try {
      await launchTools(undefined, undefined, {
        selections: [UNRESOLVED],
        events,
        startup: async () => {
          await Promise.resolve();
        },
        wait: async () => {
          await Promise.reject(new Error('aborted'));
        },
      });
      throw new Error('the cancelled wait did not fail the launch');
    } catch (error) {
      expect(error).toBeInstanceOf(LaunchCancelledError);
    }
    expect(events).toEqual(['pick', 'expand:inherit']);
  });

  test('a successful first expansion never waits for startup', async () => {
    await launchTools(undefined, undefined, {
      startup: () => {
        throw new Error('startup should not be consulted');
      },
    });
  });
});
