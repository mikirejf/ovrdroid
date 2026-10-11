import { describe, expect, test } from 'bun:test';

import { HAIKU, OPUS, SONNET, splitOf } from './subagent-model-harness.ts';
import type { Selection, Subagent } from './subagent-model-pick-harness.ts';
import {
  CODER_MEDIUM,
  HIGH_ONLY,
  inputsOf,
  PARENT,
  pick,
  PLAIN_INHERIT,
  POTETO,
  resolve,
  STOCK_MARK,
  WORKER,
} from './subagent-model-pick-harness.ts';

const XHIGH_PARENT: Selection = { modelId: HAIKU, reasoningEffort: 'xhigh' };
const BARE_PARENT: Selection = { modelId: HAIKU };

function resolveUnder(parent: Selection, launch: Parameters<typeof pick>[0], subagent: Subagent) {
  return pick(launch, { ...inputsOf(subagent), parent: () => parent });
}

describe('effort inherit means the parent effort, from every place an effort is set', () => {
  test("a droid's own reasoningEffort: inherit", () => {
    const droid: Subagent = { ...POTETO, effort: 'inherit' };
    expect(resolveUnder(XHIGH_PARENT, splitOf({}), droid)).toMatchObject({
      modelId: HAIKU,
      reasoningEffort: 'xhigh',
    });
  });

  test('the Task effort field', () => {
    expect(resolveUnder(XHIGH_PARENT, splitOf({ effort: 'inherit' }), POTETO)).toMatchObject({
      modelId: HAIKU,
      reasoningEffort: 'xhigh',
    });
  });

  test('the bracket key, with a launch model', () => {
    expect(
      resolveUnder(XHIGH_PARENT, splitOf({ model: `${OPUS}[effort=inherit]` }), POTETO),
    ).toMatchObject({ modelId: OPUS, reasoningEffort: 'xhigh' });
  });

  test('a launch inherit beats the droid effort', () => {
    expect(resolveUnder(PARENT, splitOf({ effort: 'inherit' }), POTETO)).toMatchObject({
      reasoningEffort: 'medium',
    });
  });

  test('a parent with no effort leaves the model default', () => {
    expect(resolveUnder(BARE_PARENT, splitOf({ effort: 'inherit' }), POTETO)).toMatchObject({
      modelId: HAIKU,
      reasoningEffort: undefined,
    });
  });
});

describe('the inherited effort is fitted to the final model', () => {
  test("a droid's own reasoningEffort: inherit on a fixed model", () => {
    const droid: Subagent = { ...CODER_MEDIUM, fixedModel: HIGH_ONLY, effort: 'inherit' };
    expect(resolveUnder(XHIGH_PARENT, splitOf({}), droid)).toMatchObject({
      modelId: HIGH_ONLY,
      reasoningEffort: 'high',
    });
  });

  test("a droid's reasoningEffort: inherit next to a launch model", () => {
    const droid: Subagent = { ...PLAIN_INHERIT, effort: 'inherit' };
    expect(resolveUnder(XHIGH_PARENT, { model: HIGH_ONLY }, droid)).toMatchObject({
      modelId: HIGH_ONLY,
      reasoningEffort: 'high',
    });
  });
});

describe('a fixed-model droid', () => {
  test('refuses a launch effort of inherit, as it refuses any launch effort', () => {
    expect(() => resolve(splitOf({ effort: 'inherit' }), CODER_MEDIUM)).toThrow(
      `coder-medium fixes its model (${SONNET}), so it cannot take a launch effort`,
    );
    expect(() => resolve(splitOf({ model: `${SONNET}[effort=inherit]` }), CODER_MEDIUM)).toThrow(
      'fixes its model',
    );
  });

  test('with reasoningEffort: inherit, launched bare, runs at the parent effort', () => {
    const droid: Subagent = { ...CODER_MEDIUM, effort: 'inherit' };
    const inputs = { ...inputsOf(droid), stock: () => STOCK_MARK };
    const selection = pick(splitOf({}), inputs);
    expect(selection).not.toBe(STOCK_MARK);
    expect(selection).toEqual({
      modelId: SONNET,
      reasoningEffort: 'medium',
      complexity: undefined,
    });
  });

  test('with any other reasoningEffort, launched bare, goes through stock unchanged', () => {
    for (const effort of ['high', 'low', undefined]) {
      const droid: Subagent = { name: 'fixed', custom: true, fixedModel: SONNET };
      if (effort !== undefined) {
        droid.effort = effort;
      }
      const inputs = { ...inputsOf(droid), stock: () => STOCK_MARK };
      expect(pick(splitOf({}), inputs)).toBe(STOCK_MARK);
    }
  });

  test('an inherit droid with reasoningEffort: inherit, launched bare, runs at the parent effort', () => {
    const droid: Subagent = { ...PLAIN_INHERIT, effort: 'inherit' };
    expect(resolveUnder(XHIGH_PARENT, splitOf({}), droid)).toMatchObject({
      modelId: HAIKU,
      reasoningEffort: 'xhigh',
    });
  });
});

describe('a built-in given effort inherit', () => {
  test('runs at the parent effort, without the fixed tier lowering', () => {
    expect(resolve(splitOf({ effort: 'inherit', complexity: 'light' }), WORKER)).toEqual({
      modelId: HAIKU,
      reasoningEffort: 'medium',
      complexity: 'light',
      $ODtoolModel: undefined,
    });
  });

  test("fits the parent effort to the final model's steps", () => {
    const inputs = {
      ...inputsOf(WORKER),
      parent: () => ({ modelId: HIGH_ONLY, reasoningEffort: 'xhigh' }),
      stock: () => ({ modelId: HIGH_ONLY, reasoningEffort: 'off', complexity: 'light' }),
    };
    expect(pick(splitOf({ effort: 'inherit', complexity: 'light' }), inputs)).toMatchObject({
      modelId: HIGH_ONLY,
      reasoningEffort: 'high',
    });
  });

  test('a parent with no effort leaves the model default', () => {
    expect(
      resolveUnder(BARE_PARENT, splitOf({ effort: 'inherit', complexity: 'light' }), WORKER),
    ).toMatchObject({ reasoningEffort: undefined });
  });
});
