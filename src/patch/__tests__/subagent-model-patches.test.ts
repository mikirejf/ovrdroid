import { describe, expect, test } from 'bun:test';

import { EFFORTS, MATCH_NAME, subagentModelPatches } from '../subagent-model-patches.ts';
import { describeStrayNames, patchNamed, payloadFunction } from './payload.ts';
import { shipped, stockDroid } from './stock-scanner.ts';
import type { DroidFields } from './subagent-model-harness.ts';
import { BRACKETED, droidErrors, isKnown, KNOWN, OPUS, splitOf } from './subagent-model-harness.ts';

describeStrayNames(subagentModelPatches);

describe('the launch model string splits into id, tier and effort', () => {
  test('a launch without a model keeps its tier and effort fields', () => {
    expect(splitOf({ complexity: 'heavy', effort: 'low' })).toEqual({
      complexity: 'heavy',
      effort: 'low',
    });
  });

  test('a bare id is the model', () => {
    expect(splitOf({ model: OPUS })).toMatchObject({ model: OPUS });
  });

  test('brackets give the tier and the effort', () => {
    expect(splitOf({ model: `${OPUS}[complexity=light,effort=high]` })).toMatchObject({
      model: OPUS,
      complexity: 'light',
      effort: 'high',
    });
  });

  test('inherit means the parent model, with or without brackets', () => {
    expect(splitOf({ model: 'inherit' })).toMatchObject({ inherit: true });
    expect(splitOf({ model: 'inherit[complexity=medium]' })).toEqual({
      inherit: true,
      complexity: 'medium',
      effort: undefined,
    });
  });

  test('an id that itself holds brackets still resolves, with and without a suffix', () => {
    expect(splitOf({ model: BRACKETED })).toMatchObject({ model: BRACKETED });
    expect(splitOf({ model: `${BRACKETED}[effort=xhigh]` })).toMatchObject({
      model: BRACKETED,
      effort: 'xhigh',
    });
  });

  test('a launch may give a tier in one place and an effort in the other', () => {
    expect(splitOf({ model: `${OPUS}[effort=max]`, complexity: 'light' })).toMatchObject({
      model: OPUS,
      complexity: 'light',
      effort: 'max',
    });
  });

  test('an unknown key is refused, naming the allowed keys', () => {
    expect(() => splitOf({ model: `${OPUS}[colour=red]` })).toThrow(
      'unknown key "colour". Allowed keys: complexity, effort',
    );
  });

  test('an unknown value is refused, naming the allowed values', () => {
    expect(() => splitOf({ model: `${OPUS}[effort=huge]` })).toThrow(
      'Allowed: minimal, low, medium, high, xhigh, max, inherit',
    );
    expect(() => splitOf({ model: `${OPUS}[complexity=extreme]` })).toThrow(
      'Allowed: light, medium, heavy',
    );
  });

  test('a tier or effort set in brackets and in its field is refused', () => {
    expect(() => splitOf({ model: `${OPUS}[complexity=heavy]`, complexity: 'light' })).toThrow(
      'complexity is set twice',
    );
    expect(() => splitOf({ model: `${OPUS}[effort=max]`, effort: 'low' })).toThrow(
      'effort is set twice',
    );
  });

  test('an effort of inherit is a step, in the field and in the brackets', () => {
    expect(splitOf({ effort: 'inherit' })).toMatchObject({ effort: 'inherit' });
    expect(splitOf({ model: `${OPUS}[effort=inherit]` })).toMatchObject({
      model: OPUS,
      effort: 'inherit',
    });
    expect(splitOf({ model: 'inherit[effort=inherit]' })).toMatchObject({
      inherit: true,
      effort: 'inherit',
    });
  });

  test('a key repeated inside the brackets is refused', () => {
    expect(() => splitOf({ model: `${OPUS}[effort=low,effort=high]` })).toThrow(
      'model brackets set effort twice',
    );
  });

  test('an unknown id is refused, listing every valid id', () => {
    expect(() => splitOf({ model: 'custom:droidproxy:nope-9' })).toThrow(
      `Unknown model "custom:droidproxy:nope-9". Valid model ids: inherit, ${KNOWN.join(', ')}`,
    );
  });

  test('an effort field off the scale is refused', () => {
    expect(() => splitOf({ effort: 'off' })).toThrow('effort "off" is not a step');
  });
});

const matchName = payloadFunction<[], (want: string, names: readonly string[]) => string>(
  [],
  `${MATCH_NAME}return $ODname`,
)();

describe('subagent_type matches droid names loosely', () => {
  const names = ['comment-sicko', 'coder-medium', 'worker', 'explorer'];

  test('a space equals a hyphen and case does not matter', () => {
    expect(matchName('Comment Sicko', names)).toBe('comment-sicko');
    expect(matchName('WORKER', names)).toBe('worker');
  });

  test('an exact match wins over a loose one', () => {
    expect(matchName('Foo', ['foo', 'Foo'])).toBe('Foo');
  });

  test('two loose matches leave the name as given', () => {
    expect(matchName('FOO', ['foo', 'Foo'])).toBe('FOO');
  });

  test('a name with no match is left as given', () => {
    expect(matchName('nobody', names)).toBe('nobody');
  });
});

interface EffortCheck {
  validateReasoningEffort: (model: string, effort: string) => boolean;
}

const effortCheck = payloadFunction<[], EffortCheck>(
  [],
  `return class{${patchNamed(subagentModelPatches, 'droid-validation-accepts-inherit-effort').replace}return["high"].includes(r)}}`,
)();

describe('a droid file may set reasoningEffort: inherit', () => {
  test('the effort check accepts inherit for any model, and still checks the rest', () => {
    expect(effortCheck.validateReasoningEffort('m', 'inherit')).toBe(true);
    expect(effortCheck.validateReasoningEffort('inherit', 'anything')).toBe(true);
    expect(effortCheck.validateReasoningEffort('m', 'high')).toBe(true);
    expect(effortCheck.validateReasoningEffort('m', 'low')).toBe(false);
  });
});

function errorsOf(metadata: DroidFields): string[] {
  return droidErrors(metadata, isKnown);
}

function firstErrorOf(metadata: DroidFields): string {
  return errorsOf(metadata).at(0) ?? '';
}

describe('a droid file is checked when it loads', () => {
  test('a droid without the new fields has no errors', () => {
    expect(errorsOf({ name: 'plain', model: 'inherit' })).toEqual([]);
  });

  test('a well-formed tier map, maxDepth and skills pass', () => {
    expect(
      errorsOf({
        complexity: { light: { model: KNOWN[1], effort: 'low' }, heavy: { effort: 'xhigh' } },
        maxDepth: 3,
        skills: ['poteto-mode'],
      }),
    ).toEqual([]);
  });

  test('a tier effort of inherit passes, and the steps list names inherit', () => {
    expect(errorsOf({ complexity: { light: { effort: 'inherit' } } })).toEqual([]);
    expect(firstErrorOf({ complexity: { light: { effort: 'off' } } })).toContain(
      'Steps: minimal, low, medium, high, xhigh, max, inherit',
    );
  });

  test('a tier naming an unknown model is an error that names the tier and the id', () => {
    expect(errorsOf({ complexity: { light: { model: 'custom:nope', effort: 'low' } } })).toEqual([
      'complexity.light: model "custom:nope" is not a valid model id',
    ]);
  });

  test.each([
    ['a value that is not a map', 'heavy', 'complexity must map tiers'],
    ['an unknown tier', { extreme: { effort: 'low' } }, 'unknown tier "extreme"'],
    ['an empty tier', { light: {} }, 'complexity.light sets neither model nor effort'],
    ['an effort off the scale', { light: { effort: 'off' } }, 'effort "off" is not a step'],
    ['an unknown key', { light: { effort: 'low', speed: 'fast' } }, 'unknown key "speed"'],
    ['a tier that is not a map', { light: 'low' }, 'complexity.light must be a map'],
  ])('a tier map with %s is an error', (_label, complexity, message) => {
    expect(firstErrorOf({ complexity })).toContain(message);
  });

  test.each([0, -1, 2.5, '3'])('maxDepth %p is an error', (maxDepth) => {
    expect(firstErrorOf({ maxDepth })).toContain('maxDepth must be a positive integer');
  });

  test.each(['poteto-mode', [1], { a: 'b' }])('skills %p is an error', (skills) => {
    expect(firstErrorOf({ skills })).toContain('skills must be a list of skill names');
  });
});

interface ClampRequest {
  modelId: string;
  complexity?: string;
  inherited?: string;
  $ODclamp?: boolean;
}

const STEPS: readonly string[] = EFFORTS.filter((step) => step !== 'inherit');

function clampWith(supported: readonly string[]): (request: ClampRequest) => string | undefined {
  const atOrBelow = (_model: string, effort: string): string | undefined =>
    supported.findLast((step) => STEPS.indexOf(step) <= STEPS.indexOf(effort));
  const { replace } = patchNamed(subagentModelPatches, 'effort-clamps-to-model');
  return payloadFunction<
    [typeof atOrBelow, () => readonly string[]],
    (request: ClampRequest) => string | undefined
  >(['U6', 'jL'], `return ${replace}return "stock"}`)(atOrBelow, () => supported);
}

interface ClampCase {
  supported: readonly string[];
  inherited: string;
  expected: string;
}

const CLAMP_CASES: readonly (readonly [string, ClampCase])[] = [
  [
    'keeps a supported step',
    { supported: ['low', 'high', 'max'], inherited: 'high', expected: 'high' },
  ],
  [
    'lowers a step to the highest supported one at or below it',
    { supported: ['low', 'high'], inherited: 'max', expected: 'high' },
  ],
  [
    'raises a step below every supported one to the lowest',
    { supported: ['medium', 'high'], inherited: 'minimal', expected: 'medium' },
  ],
  [
    'keeps the request when the model names no step',
    { supported: [], inherited: 'xhigh', expected: 'xhigh' },
  ],
];

describe('the effort clamp', () => {
  test.each(CLAMP_CASES)('%s', (_label, { supported, inherited, expected }) => {
    expect(clampWith(supported)({ modelId: 'm', inherited, $ODclamp: true })).toBe(expected);
  });

  test('leaves the stock tier path alone without the clamp flag', () => {
    expect(clampWith(['low'])({ modelId: 'm', complexity: 'light', inherited: 'high' })).toBe(
      'stock',
    );
  });
});

describe.skipIf(stockDroid === undefined)('the shipped Task launcher', () => {
  const { patchedText, rebasedNamed } = shipped(subagentModelPatches);

  test.each(subagentModelPatches.map((patch) => [patch.name] as const))(
    '%s lands exactly once',
    (name) => {
      expect(patchedText.split(rebasedNamed(name).replace)).toHaveLength(2);
    },
  );

  test('names the droid registry loader once in the whole launcher', () => {
    const start = patchedText.indexOf('static async buildStreamJsonRpcTaskConfig');
    const end = patchedText.indexOf('static async listAvailableSubagents', start);
    expect(start).toBeGreaterThan(-1);
    expect(patchedText.slice(start, end).split('loadAllDroids')).toHaveLength(2);
  });

  test('the Task effort field and its description name inherit', () => {
    expect(patchedText).toContain('"xhigh","max","inherit"]');
    expect(patchedText).toContain('\\"inherit\\" means this session');
  });

  test('no longer says custom subagents ignore the tier', () => {
    expect(patchedText).not.toContain('Ignored for custom subagents');
  });
});
