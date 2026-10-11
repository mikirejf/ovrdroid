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
  TIERED,
  WORKER,
} from './subagent-model-pick-harness.ts';
import type { Subagent } from './subagent-model-pick-harness.ts';

describe('a launch picks the model and effort in the spec order', () => {
  test('a launch model with a heavy tier runs that model at the tier effort, above the parent', () => {
    expect(resolve(splitOf({ model: `${OPUS}[complexity=heavy]` }), POTETO)).toEqual({
      modelId: OPUS,
      reasoningEffort: 'xhigh',
      complexity: 'heavy',
      $ODtoolModel: OPUS,
    });
  });

  test("a launch model without a tier runs at the droid's reasoningEffort", () => {
    expect(resolve(splitOf({ model: OPUS }), POTETO)).toMatchObject({
      modelId: OPUS,
      reasoningEffort: 'high',
    });
  });

  test("a tier alone runs the tier's model and effort", () => {
    expect(resolve(splitOf({ complexity: 'light' }), TIERED)).toMatchObject({
      modelId: SONNET,
      reasoningEffort: 'low',
    });
  });

  test("a launch model wins over the tier's model, and the tier's effort still applies", () => {
    expect(resolve(splitOf({ model: `${OPUS}[complexity=light]` }), TIERED)).toMatchObject({
      modelId: OPUS,
      reasoningEffort: 'low',
    });
  });

  test("a launch effort wins over the tier's effort", () => {
    expect(resolve(splitOf({ model: `${OPUS}[effort=max]` }), POTETO)).toMatchObject({
      modelId: OPUS,
      reasoningEffort: 'max',
    });
    expect(
      resolve(splitOf({ model: `${OPUS}[effort=max]`, complexity: 'light' }), POTETO),
    ).toMatchObject({ modelId: OPUS, reasoningEffort: 'max', complexity: 'light' });
  });

  test("inherit with a tier runs the parent's model at the tier's effort", () => {
    expect(resolve(splitOf({ model: 'inherit[complexity=medium]' }), POTETO)).toMatchObject({
      modelId: HAIKU,
      reasoningEffort: 'high',
    });
  });

  test("the parent's effort applies only when the model is the parent's", () => {
    const droid: Subagent = { name: 'mapped', custom: true, tiers: { heavy: { model: OPUS } } };
    expect(resolve(splitOf({ model: 'inherit[complexity=heavy]' }), droid)).toEqual({
      modelId: HAIKU,
      reasoningEffort: 'medium',
      complexity: 'heavy',
    });
    expect(resolve(splitOf({ complexity: 'heavy' }), droid)).toEqual({
      modelId: OPUS,
      reasoningEffort: undefined,
      complexity: 'heavy',
      $ODtoolModel: OPUS,
    });
  });

  test('the effort is fitted to what the final model supports', () => {
    const droid: Subagent = {
      name: 'capped',
      custom: true,
      tiers: { heavy: { model: HIGH_ONLY, effort: 'max' } },
    };
    expect(pick({ complexity: 'heavy' }, { ...inputsOf(droid), valid: () => true })).toMatchObject({
      modelId: HIGH_ONLY,
      reasoningEffort: 'high',
    });
  });

  test('a fixed-model droid with a tier map takes its tier models', () => {
    const droid: Subagent = { ...CODER_MEDIUM, tiers: { heavy: { model: OPUS, effort: 'max' } } };
    expect(resolve(splitOf({ complexity: 'heavy' }), droid)).toMatchObject({
      modelId: OPUS,
      reasoningEffort: 'max',
    });
    expect(resolve(splitOf({}), droid)).toEqual({ modelId: SONNET, reasoningEffort: 'high' });
  });
});

describe('a launch that a droid cannot take is refused', () => {
  test('a droid without a tier map refuses a tier, in the field or in brackets', () => {
    expect(() => resolve(splitOf({ complexity: 'heavy' }), CODER_MEDIUM)).toThrow(
      'coder-medium has no tier map, so it cannot take a tier',
    );
    expect(() => resolve(splitOf({ model: 'inherit[complexity=heavy]' }), PLAIN_INHERIT)).toThrow(
      'generalPurpose has no tier map, so it cannot take a tier',
    );
  });

  test('a fixed-model droid refuses any launch model, inherit included', () => {
    expect(() => resolve(splitOf({ model: OPUS }), CODER_MEDIUM)).toThrow(
      `coder-medium fixes its model (${SONNET}), so it cannot take a launch model`,
    );
    expect(() => resolve(splitOf({ model: 'inherit' }), CODER_MEDIUM)).toThrow(
      'cannot take a launch model',
    );
  });

  test('a fixed-model droid refuses a launch effort', () => {
    expect(() => resolve(splitOf({ effort: 'xhigh' }), CODER_MEDIUM)).toThrow(
      `coder-medium fixes its model (${SONNET}), so it cannot take a launch effort`,
    );
  });

  test('a tier the map does not name is refused, listing the tiers it has', () => {
    expect(() => resolve(splitOf({ complexity: 'medium' }), TIERED)).toThrow(
      'tiered has no medium tier in its tier map. Its tiers: light, heavy',
    );
  });

  test('a tier model this session cannot use is refused at launch', () => {
    const droid: Subagent = {
      name: 'gone',
      custom: true,
      tiers: { light: { model: 'custom:retired', effort: 'low' } },
    };
    expect(() => resolve(splitOf({ complexity: 'light' }), droid)).toThrow(
      'gone\'s light tier names model "custom:retired", which this session cannot use',
    );
  });
});

describe('a launch without a new field resolves exactly as stock does', () => {
  test.each([
    ['a fixed-model droid', CODER_MEDIUM],
    ['an inherit droid without a tier map', PLAIN_INHERIT],
    ['a built-in', WORKER],
  ] as const)('%s takes the stock path', (_label, subagent) => {
    const inputs = { ...inputsOf(subagent), stock: () => STOCK_MARK };
    expect(pick(splitOf({}), inputs)).toBe(STOCK_MARK);
    expect(resolve(splitOf({}), subagent)).toEqual(stockOf(subagent)());
  });

  test('a built-in given only a tier keeps the stock fixed mapping', () => {
    expect(resolve(splitOf({ complexity: 'light' }), WORKER)).toEqual(stockOf(WORKER)('light'));
  });
});

describe('a droid with a tier map picks its model and effort on every launch', () => {
  test('an inherit droid launched bare runs the parent model at its own reasoningEffort', () => {
    expect(resolve(splitOf({}), POTETO)).toEqual({
      modelId: HAIKU,
      reasoningEffort: 'high',
      complexity: undefined,
    });
  });

  test('a tier map makes the bare launch leave the stock path', () => {
    const inputs = { ...inputsOf(POTETO), stock: () => STOCK_MARK };
    expect(pick(splitOf({}), inputs)).not.toBe(STOCK_MARK);
  });

  test("an inherit droid without a reasoningEffort keeps the parent's effort", () => {
    const droid: Subagent = { ...POTETO };
    delete droid.effort;
    expect(resolve(splitOf({}), droid)).toMatchObject({
      modelId: HAIKU,
      reasoningEffort: 'medium',
    });
  });

  test("the droid's reasoningEffort is fitted to the parent model", () => {
    const droid: Subagent = { ...POTETO, effort: 'max' };
    const inputs = { ...inputsOf(droid), clamp: () => 'high' };
    expect(pick(splitOf({}), inputs)).toMatchObject({ modelId: HAIKU, reasoningEffort: 'high' });
  });
});

describe('the model that picks the tools is the one a launch or a tier chose', () => {
  test('a launch model is the tool model', () => {
    expect(resolve(splitOf({ model: OPUS }), POTETO).$ODtoolModel).toBe(OPUS);
    expect(resolve(splitOf({ model: OPUS }), WORKER).$ODtoolModel).toBe(OPUS);
    expect(resolve(splitOf({ model: OPUS }), PLAIN_INHERIT).$ODtoolModel).toBe(OPUS);
  });

  test('a tier model is the tool model, also for a fixed-model droid', () => {
    expect(resolve(splitOf({ complexity: 'heavy' }), TIERED).$ODtoolModel).toBe(OPUS);
    const fixed: Subagent = { ...CODER_MEDIUM, tiers: { heavy: { model: OPUS } } };
    expect(resolve(splitOf({ complexity: 'heavy' }), fixed).$ODtoolModel).toBe(OPUS);
  });

  test("a launch model wins over the tier's model", () => {
    expect(resolve(splitOf({ model: `${SONNET}[complexity=heavy]` }), TIERED).$ODtoolModel).toBe(
      SONNET,
    );
  });

  test.each([
    ['a fixed-model droid launched bare', CODER_MEDIUM, {}],
    [
      'a fixed-model droid whose tier names no model',
      { ...CODER_MEDIUM, tiers: { light: { effort: 'low' } } },
      { complexity: 'light' },
    ],
    ['an inherit droid launched bare', POTETO, {}],
    ['an inherit droid given inherit', POTETO, { model: 'inherit' }],
    ['an inherit droid given a tier with no model', POTETO, { complexity: 'heavy' }],
    ['a built-in launched bare', WORKER, {}],
  ] as const)('%s leaves the tool model to the droid file', (_label, subagent, fields) => {
    expect(resolve(splitOf(fields), subagent).$ODtoolModel).toBeUndefined();
  });

  test('inherit given to a droid whose tier names a model still runs the parent model', () => {
    const selection = resolve(splitOf({ model: 'inherit[complexity=heavy]' }), TIERED);
    expect(selection.modelId).toBe(HAIKU);
    expect(selection.$ODtoolModel).toBeUndefined();
  });
});

describe('a built-in takes a launch model and a launch effort', () => {
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
