import { describe, expect, test } from 'bun:test';

import { HAIKU, OPUS, SONNET, splitOf } from './subagent-model-harness.ts';
import {
  CODER_MEDIUM,
  HIGH_ONLY,
  inputsOf,
  pick,
  PLAIN_INHERIT,
  POTETO,
  resolve,
  STOCK_MARK,
  stockOf,
  WORKER,
} from './subagent-model-pick-harness.ts';
import type { Subagent } from './subagent-model-pick-harness.ts';

describe('an inherit droid picks its model in the spec order', () => {
  test('a launch model beats the parent model and is the tool model', () => {
    expect(resolve(splitOf({ model: OPUS }), POTETO)).toMatchObject({
      modelId: OPUS,
      $ODtoolModel: OPUS,
    });
  });

  test('no launch model runs the parent model, and the droid file picks the tools', () => {
    const selection = resolve(splitOf({ effort: 'max' }), POTETO);
    expect(selection.modelId).toBe(HAIKU);
    expect(selection.$ODtoolModel).toBeUndefined();
  });

  test('inherit runs the parent model', () => {
    const selection = resolve(splitOf({ model: 'inherit' }), POTETO);
    expect(selection.modelId).toBe(HAIKU);
    expect(selection.$ODtoolModel).toBeUndefined();
  });
});

describe('an inherit droid picks its effort in the spec order', () => {
  test('a launch effort beats the droid reasoningEffort', () => {
    expect(resolve(splitOf({ model: `${OPUS}[effort=max]` }), POTETO)).toMatchObject({
      modelId: OPUS,
      reasoningEffort: 'max',
    });
    expect(resolve(splitOf({ effort: 'max' }), POTETO)).toMatchObject({
      modelId: HAIKU,
      reasoningEffort: 'max',
    });
  });

  test('inherit[effort=xhigh] runs the parent model at xhigh', () => {
    expect(resolve(splitOf({ model: 'inherit[effort=xhigh]' }), POTETO)).toMatchObject({
      modelId: HAIKU,
      reasoningEffort: 'xhigh',
    });
  });

  test('a launch effort of inherit is the parent effort', () => {
    expect(resolve(splitOf({ effort: 'inherit' }), POTETO)).toMatchObject({
      modelId: HAIKU,
      reasoningEffort: 'medium',
    });
  });

  test('without a launch effort the droid reasoningEffort applies, also on a launch model', () => {
    expect(resolve(splitOf({ model: OPUS }), POTETO)).toMatchObject({
      modelId: OPUS,
      reasoningEffort: 'high',
    });
    expect(resolve(splitOf({ model: 'inherit' }), POTETO)).toMatchObject({
      modelId: HAIKU,
      reasoningEffort: 'high',
    });
  });

  test('a droid reasoningEffort of inherit is the parent effort, also on a launch model', () => {
    const droid: Subagent = { ...POTETO, effort: 'inherit' };
    expect(resolve(splitOf({ model: OPUS }), droid)).toMatchObject({
      modelId: OPUS,
      reasoningEffort: 'medium',
    });
  });

  test('with no effort anywhere, the parent effort applies only to the parent model', () => {
    const droid: Subagent = { ...PLAIN_INHERIT };
    expect(resolve(splitOf({ model: 'inherit' }), droid)).toMatchObject({
      modelId: HAIKU,
      reasoningEffort: 'medium',
    });
    expect(resolve(splitOf({ model: OPUS }), droid)).toMatchObject({
      modelId: OPUS,
      reasoningEffort: undefined,
    });
  });

  test('the effort is fitted to what the final model supports', () => {
    expect(resolve({ model: HIGH_ONLY, effort: 'max' }, POTETO)).toMatchObject({
      modelId: HIGH_ONLY,
      reasoningEffort: 'high',
    });
    const inputs = { ...inputsOf({ ...POTETO, effort: 'max' }), clamp: () => 'high' };
    expect(pick(splitOf({ model: 'inherit' }), inputs)).toMatchObject({
      modelId: HAIKU,
      reasoningEffort: 'high',
    });
  });
});

describe('a custom droid refuses a tier', () => {
  test.each([
    ['a fixed-model droid', CODER_MEDIUM],
    ['an inherit droid', PLAIN_INHERIT],
    ['an inherit droid with an effort', POTETO],
  ] as const)('%s, and the error names it', (_label, droid) => {
    expect(() => resolve(splitOf({ complexity: 'heavy' }), droid)).toThrow(
      `${droid.name} is a custom agent, so it cannot take a tier. Launch it without complexity`,
    );
  });

  test('the tier is refused next to a launch model and a launch effort too', () => {
    expect(() =>
      resolve(splitOf({ model: OPUS, effort: 'low', complexity: 'light' }), POTETO),
    ).toThrow('poteto-agent is a custom agent, so it cannot take a tier');
  });

  test('a tier in the model brackets is an unknown key, so it never reaches the pick', () => {
    expect(() => splitOf({ model: 'inherit[complexity=heavy]' })).toThrow(
      'model brackets: unknown key "complexity". Allowed keys: effort',
    );
    expect(() => splitOf({ model: `${OPUS}[complexity=light,effort=high]` })).toThrow(
      'unknown key "complexity"',
    );
  });
});

describe('a fixed-model droid takes nothing from the launch', () => {
  test('any launch model is refused, inherit included', () => {
    expect(() => resolve(splitOf({ model: OPUS }), CODER_MEDIUM)).toThrow(
      `coder-medium fixes its model (${SONNET}), so it cannot take a launch model`,
    );
    expect(() => resolve(splitOf({ model: 'inherit' }), CODER_MEDIUM)).toThrow(
      'cannot take a launch model',
    );
  });

  test('a launch effort is refused', () => {
    expect(() => resolve(splitOf({ effort: 'xhigh' }), CODER_MEDIUM)).toThrow(
      `coder-medium fixes its model (${SONNET}), so it cannot take a launch effort`,
    );
  });

  test('a bare launch takes the stock path: the file model at the file effort', () => {
    const inputs = { ...inputsOf(CODER_MEDIUM), stock: () => STOCK_MARK };
    expect(pick(splitOf({}), inputs)).toBe(STOCK_MARK);
    expect(resolve(splitOf({}), CODER_MEDIUM)).toEqual({
      modelId: SONNET,
      reasoningEffort: 'high',
    });
  });
});

function lowParent() {
  return { modelId: HAIKU, reasoningEffort: 'low' };
}
function lowHighOnlyParent() {
  return { modelId: HIGH_ONLY, reasoningEffort: 'low' };
}

describe('a bare launch resolves exactly as stock does, unless an inherit droid sets an effort', () => {
  test.each([
    ['a fixed-model droid', CODER_MEDIUM],
    [
      'a fixed-model droid without a reasoningEffort',
      { name: 'fixed', custom: true, fixedModel: SONNET },
    ],
    ['an inherit droid without a reasoningEffort', PLAIN_INHERIT],
    ['a built-in', WORKER],
  ] as const)('%s takes the stock path', (_label, subagent) => {
    const inputs = { ...inputsOf(subagent), stock: () => STOCK_MARK };
    expect(pick(splitOf({}), inputs)).toBe(STOCK_MARK);
    expect(resolve(splitOf({}), subagent)).toEqual(stockOf(subagent)());
  });

  test('an inherit droid with a reasoningEffort leaves the stock path', () => {
    const inputs = { ...inputsOf(POTETO), stock: () => STOCK_MARK };
    expect(pick(splitOf({}), inputs)).not.toBe(STOCK_MARK);
  });

  test('a bare launch of an inherit droid runs the parent model at its reasoningEffort', () => {
    expect(pick(splitOf({}), { ...inputsOf(POTETO), parent: lowParent })).toEqual({
      modelId: HAIKU,
      reasoningEffort: 'high',
      complexity: undefined,
    });
  });

  test('that reasoningEffort is fitted to the parent model', () => {
    const droid: Subagent = { ...POTETO, effort: 'max' };
    expect(pick(splitOf({}), { ...inputsOf(droid), parent: lowHighOnlyParent })).toMatchObject({
      modelId: HIGH_ONLY,
      reasoningEffort: 'high',
    });
  });

  test('an inherit droid without a reasoningEffort keeps the parent effort', () => {
    const inputs = { ...inputsOf(PLAIN_INHERIT), parent: lowParent, stock: lowParent };
    expect(pick(splitOf({}), inputs)).toEqual({ modelId: HAIKU, reasoningEffort: 'low' });
  });

  test('an inherit droid with reasoningEffort: inherit runs the parent model at the parent effort', () => {
    const droid: Subagent = { ...PLAIN_INHERIT, effort: 'inherit' };
    expect(resolve(splitOf({}), droid)).toEqual({
      modelId: HAIKU,
      reasoningEffort: 'medium',
      complexity: undefined,
    });
  });

  test('a fixed-model droid with reasoningEffort: inherit still goes through the pick', () => {
    const droid: Subagent = { ...CODER_MEDIUM, effort: 'inherit' };
    const inputs = { ...inputsOf(droid), stock: () => STOCK_MARK };
    expect(pick(splitOf({}), inputs)).toEqual({
      modelId: SONNET,
      reasoningEffort: 'medium',
      complexity: undefined,
    });
  });
});

describe('the model that picks the tools is the launch model', () => {
  test('a launch model is the tool model, for every kind of agent', () => {
    expect(resolve(splitOf({ model: OPUS }), POTETO).$ODtoolModel).toBe(OPUS);
    expect(resolve(splitOf({ model: OPUS }), WORKER).$ODtoolModel).toBe(OPUS);
    expect(resolve(splitOf({ model: OPUS }), PLAIN_INHERIT).$ODtoolModel).toBe(OPUS);
  });

  test.each([
    ['a fixed-model droid launched bare', CODER_MEDIUM, {}],
    ['an inherit droid launched bare', POTETO, {}],
    ['an inherit droid given inherit', POTETO, { model: 'inherit' }],
    ['an inherit droid given only an effort', POTETO, { effort: 'low' }],
    ['a built-in launched bare', WORKER, {}],
  ] as const)('%s leaves the tool model to the droid file', (_label, subagent, fields) => {
    expect(resolve(splitOf(fields), subagent).$ODtoolModel).toBeUndefined();
  });
});

describe('a built-in keeps the stock tier and takes a launch model and a launch effort', () => {
  test('a tier alone keeps the stock fixed mapping', () => {
    expect(resolve(splitOf({ complexity: 'light' }), WORKER)).toEqual(stockOf(WORKER)('light'));
  });

  test('a launch model wins and the tier still sets the effort the stock way', () => {
    expect(resolve(splitOf({ model: OPUS, complexity: 'light' }), WORKER)).toEqual({
      modelId: OPUS,
      reasoningEffort: 'off',
      complexity: 'light',
      $ODtoolModel: OPUS,
    });
  });

  test('a launch effort wins over the tier mapping', () => {
    expect(resolve(splitOf({ effort: 'xhigh', complexity: 'light' }), WORKER)).toEqual({
      modelId: HAIKU,
      reasoningEffort: 'xhigh',
      complexity: 'light',
    });
  });
});
