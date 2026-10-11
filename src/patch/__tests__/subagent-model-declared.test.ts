import { describe, expect, test } from 'bun:test';

import {
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

  test('a tier is refused, as it is for every custom droid', () => {
    expect(() => resolve(splitOf({ complexity: 'heavy' }), UNAVAILABLE)).toThrow(
      'retired is a custom agent, so it cannot take a tier',
    );
  });
});

describe('an explicit model id is not empty', () => {
  const VALID_IDS = 'Valid model ids: inherit, ';

  test.each([
    ['an empty string', ''],
    ['blanks', '   '],
    ['brackets alone', '[effort=inherit]'],
    ['brackets with blanks around them', '  [effort=high]  '],
    ['an empty id before brackets', ' [effort=low]'],
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
});
