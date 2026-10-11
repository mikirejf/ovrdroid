import { describe, expect, test } from 'bun:test';

import {
  droidErrors,
  isKnownOrEmpty,
  OPUS,
  SONNET,
  splitAsStockValidates,
  splitOf,
} from './subagent-model-harness.ts';
import type { Subagent } from './subagent-model-pick-harness.ts';
import {
  inputsOf,
  pick,
  PARENT,
  resolve,
  STOCK_MARK,
  stockOf,
} from './subagent-model-pick-harness.ts';

const UNAVAILABLE: Subagent = {
  name: 'retired',
  custom: true,
  declaredModel: 'custom:retired:model',
  effort: 'high',
};

describe('a droid that declares a model fixes it, even when the model is not configured', () => {
  test('a launch model is refused, naming the declared id', () => {
    expect(() => resolve(splitOf({ model: OPUS }), UNAVAILABLE)).toThrow(
      'retired fixes its model (custom:retired:model), so it cannot take a launch model',
    );
    expect(() => resolve(splitOf({ model: 'inherit' }), UNAVAILABLE)).toThrow(
      'so it cannot take a launch model',
    );
  });

  test('a launch effort is refused, in the field and in the brackets', () => {
    expect(() => resolve(splitOf({ effort: 'xhigh' }), UNAVAILABLE)).toThrow(
      'retired fixes its model (custom:retired:model), so it cannot take a launch effort',
    );
    expect(() => resolve(splitOf({ effort: 'inherit' }), UNAVAILABLE)).toThrow(
      'cannot take a launch effort',
    );
  });

  test('a bare launch takes the stock path, which falls back to the parent model', () => {
    const inputs = { ...inputsOf(UNAVAILABLE), stock: () => STOCK_MARK };
    expect(pick(splitOf({}), inputs)).toBe(STOCK_MARK);
    expect(resolve(splitOf({}), UNAVAILABLE)).toEqual(stockOf(UNAVAILABLE)());
    expect(resolve(splitOf({}), UNAVAILABLE)).toEqual(PARENT);
  });

  test('a droid whose declared model resolves is refused the same way', () => {
    const droid: Subagent = { name: 'coder', custom: true, fixedModel: SONNET };
    expect(() => resolve(splitOf({ model: OPUS }), droid)).toThrow(
      `coder fixes its model (${SONNET}), so it cannot take a launch model`,
    );
  });

  test('a droid that declares nothing, or inherit, takes a launch model and effort', () => {
    const droid: Subagent = { name: 'open', custom: true };
    expect(resolve(splitOf({ model: OPUS, effort: 'high' }), droid)).toMatchObject({
      modelId: OPUS,
      reasoningEffort: 'high',
    });
  });

  test('a tier map on it still takes its tier, as a fixed-model droid does', () => {
    const droid: Subagent = {
      ...UNAVAILABLE,
      tiers: { heavy: { model: OPUS, effort: 'max' } },
    };
    expect(resolve(splitOf({ complexity: 'heavy' }), droid)).toMatchObject({
      modelId: OPUS,
      reasoningEffort: 'max',
    });
  });
});

describe('an explicit model id is not empty', () => {
  const VALID_IDS = 'Valid model ids: inherit, ';

  test.each([
    ['an empty string', ''],
    ['blanks', '   '],
    ['brackets alone', '[effort=inherit]'],
    ['brackets with blanks around them', '  [effort=high]  '],
    ['an empty id before brackets', ' [complexity=heavy,effort=low]'],
  ])('%s is refused with the valid ids listed', (_label, model) => {
    expect(() => splitAsStockValidates({ model })).toThrow(VALID_IDS);
  });

  test('the check is what refuses it, since the validator itself accepts the empty id', () => {
    expect(isKnownOrEmpty('')).toBe(true);
  });

  test('a real id and inherit still split', () => {
    expect(splitAsStockValidates({ model: ` ${OPUS} ` })).toMatchObject({ model: OPUS });
    expect(splitAsStockValidates({ model: 'inherit[effort=low]' })).toMatchObject({
      inherit: true,
    });
  });

  test('a tier model that is empty is refused at launch', () => {
    const droid: Subagent = { name: 'blank', custom: true, tiers: { light: { model: '  ' } } };
    const inputs = { ...inputsOf(droid), valid: isKnownOrEmpty };
    expect(() => pick(splitOf({ complexity: 'light' }), inputs)).toThrow(
      'blank\'s light tier names model "  ", which this session cannot use',
    );
  });
});

describe('a droid file whose tier model is empty fails to load', () => {
  test.each([
    ['an empty string', ''],
    ['blanks', '   '],
  ])('%s is a tier error naming the tier', (_label, model) => {
    expect(droidErrors({ complexity: { light: { model } } }, isKnownOrEmpty)).toEqual([
      `complexity.light: model "${model}" is not a valid model id`,
    ]);
  });
});
