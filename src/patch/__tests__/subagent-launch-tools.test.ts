import { describe, expect, test } from 'bun:test';

import { payloadFunction } from './payload.ts';
import type { Level } from './subagent-launch-tools-harness.ts';
import {
  EVERYTHING,
  expandedFor,
  GPT,
  HIDDEN,
  launchTools,
  lowerOf,
  patched,
  READ_ONLY,
} from './subagent-launch-tools-harness.ts';
import { SONNET } from './subagent-model-harness.ts';

describe('readonly on a launch applies the explorer read-only policy', () => {
  test('a droid with no tool list keeps only the read-only tools', async () => {
    const result = await launchTools(true);
    expect(result.tools).toEqual(READ_ONLY);
    expect(result.restricted).toBe(true);
    expect(result.readOnlyPolicy).toBe(true);
  });

  test('a droid with its own tool list keeps the read-only tools it already had', async () => {
    const result = await launchTools(true, ['Read', 'Edit', 'Create', 'Task']);
    expect(result.tools).toEqual(['Read', HIDDEN]);
    expect(result.restricted).toBe(true);
  });

  test('a droid that lists only edit tools ends with the hidden tools alone, and the list still applies', async () => {
    const result = await launchTools(true, ['Edit', 'Create']);
    expect(result.tools).toEqual([HIDDEN]);
    expect(result.restricted).toBe(true);
    expect(result.readOnlyPolicy).toBe(true);
  });

  test('a droid that is already read-only stays the same', async () => {
    const { tools } = await launchTools(true, 'read-only');
    expect(tools).toEqual(READ_ONLY);
  });

  test.each([
    ['absent', undefined],
    ['false', false],
  ])('readonly %s changes nothing for a droid with no tool list', async (_label, readonly) => {
    const result = await launchTools(readonly);
    expect(result.tools).toEqual(EVERYTHING);
    expect(result.restricted).toBe(false);
    expect(result.readOnlyPolicy).toBe(false);
  });

  test.each([
    ['absent', undefined],
    ['false', false],
  ])('readonly %s changes nothing for a droid with its own tool list', async (_label, readonly) => {
    const result = await launchTools(readonly, ['Read', 'Edit']);
    expect(result.tools).toEqual(['Read', 'Edit', HIDDEN]);
    expect(result.restricted).toBe(true);
    expect(result.readOnlyPolicy).toBe(false);
  });
});

describe('readonly on a launch lets the shell run commands up to medium risk', () => {
  test.each([
    ['high', 'medium'],
    ['medium', 'medium'],
    ['low', 'low'],
    ['off', 'off'],
  ] as const)('in a session at %s the subagent runs at %s', async (session, expected) => {
    const { autonomy } = await launchTools(true, undefined, { session });
    expect(autonomy).toBe(expected);
  });

  test('a droid with its own tool list is capped the same way', async () => {
    const { autonomy } = await launchTools(true, ['Read', 'Edit']);
    expect(autonomy).toBe('medium');
  });

  test.each([
    ['with the flag', true],
    ['without the flag', undefined],
  ])('a droid whose own tools are read-only stays at low, %s', async (_label, readonly) => {
    const { autonomy } = await launchTools(readonly, 'read-only');
    expect(autonomy).toBe('low');
  });

  test.each([
    ['absent', undefined],
    ['false', false],
  ])('readonly %s leaves the subagent at the session level', async (_label, readonly) => {
    const { autonomy } = await launchTools(readonly);
    expect(autonomy).toBe('high');
  });
});

interface ResumeConfig {
  parentAutonomyLevel: Level;
}

const resumedAutonomy = payloadFunction<[boolean, ResumeConfig, typeof lowerOf], Level>(
  ['ye', 'S', 'Rs'],
  `let ${patched('task-readonly-child-keeps-medium-autonomy')};return me`,
);

describe('a subagent launched with readonly keeps medium when it is resumed or reattached', () => {
  test('a read-only child of a session at high comes back at medium', () => {
    expect(resumedAutonomy(true, { parentAutonomyLevel: 'high' }, lowerOf)).toBe('medium');
  });

  test('a child whose droid is read-only arrives already capped and stays at low', () => {
    expect(resumedAutonomy(true, { parentAutonomyLevel: 'low' }, lowerOf)).toBe('low');
  });

  test('a child that is not read-only keeps the session level', () => {
    expect(resumedAutonomy(false, { parentAutonomyLevel: 'high' }, lowerOf)).toBe('high');
  });
});

describe('the tools are expanded for the model the launch ends up on', () => {
  test('the model is picked before the tools are expanded', async () => {
    const events: string[] = [];
    await launchTools(undefined, undefined, {
      droidModel: SONNET,
      events,
      picked: { modelId: SONNET },
    });
    expect(events).toEqual(['pick', `expand:${SONNET}`]);
  });

  test('an inherit droid launched on a GPT model gets ApplyPatch, not Edit and Create', async () => {
    const { tools, modelId } = await launchTools(undefined, undefined, {
      picked: { modelId: GPT, $ODtoolModel: GPT },
    });
    expect(modelId).toBe(GPT);
    expect(tools).toContain('ApplyPatch');
    expect(tools).not.toContain('Edit');
    expect(tools).not.toContain('Create');
  });

  test('a launch model that moves to the Sonnet family swaps ApplyPatch for Edit and Create', async () => {
    const { tools } = await launchTools(undefined, undefined, {
      droidModel: GPT,
      picked: { modelId: SONNET, $ODtoolModel: SONNET },
    });
    expect(tools).toContain('Edit');
    expect(tools).toContain('Create');
    expect(tools).not.toContain('ApplyPatch');
  });

  test('a read-only launch expands both lists for the final model', async () => {
    const events: string[] = [];
    await launchTools(true, ['Read', 'Edit'], {
      droidModel: SONNET,
      events,
      picked: { modelId: GPT, $ODtoolModel: GPT },
    });
    expect(events.filter((event) => event.startsWith('expand:'))).toEqual([
      `expand:${GPT}`,
      `expand:${GPT}`,
    ]);
  });

  test('a model the pick left alone expands exactly as stock does, for the droid file model', async () => {
    const events: string[] = [];
    const { tools } = await launchTools(undefined, ['Read', 'Edit'], {
      droidModel: SONNET,
      events,
      picked: { modelId: SONNET },
    });
    expect(tools).toEqual(expandedFor(['Read', 'Edit'], SONNET));
    expect(events).toEqual(['pick', `expand:${SONNET}`]);
  });

  test('a pick that chose the droid model changes nothing', async () => {
    const { tools: stockTools } = await launchTools(undefined, undefined, { droidModel: SONNET });
    const { tools: picked } = await launchTools(undefined, undefined, {
      droidModel: SONNET,
      picked: { modelId: SONNET, $ODtoolModel: SONNET },
    });
    expect(picked).toEqual(stockTools);
  });

  test('an inherit droid keeps the inherit expansion, whatever model the parent runs', async () => {
    const events: string[] = [];
    const { tools } = await launchTools(undefined, undefined, { events, picked: { modelId: GPT } });
    expect(tools).toEqual(EVERYTHING);
    expect(events).toEqual(['pick', 'expand:inherit']);
  });
});

describe('the pick is told which model the droid file declares', () => {
  test('a declared id counts even when the session fell back to inherit', async () => {
    const { pickInputs } = await launchTools(undefined, undefined, {
      declaredModel: SONNET,
      droidModel: 'inherit',
    });
    expect(pickInputs).toMatchObject({ declaredModel: SONNET, fixedModel: undefined });
  });

  test('a declared id that resolves is both declared and fixed', async () => {
    const { pickInputs } = await launchTools(undefined, undefined, {
      declaredModel: SONNET,
      droidModel: SONNET,
    });
    expect(pickInputs).toMatchObject({ declaredModel: SONNET, fixedModel: SONNET });
  });

  test.each([
    ['inherit', 'inherit'],
    ['no model', undefined],
    ['an empty model', ''],
    ['a blank model', '   '],
  ])('%s declares nothing', async (_label, declaredModel) => {
    const options = declaredModel === undefined ? {} : { declaredModel };
    const { pickInputs } = await launchTools(undefined, undefined, options);
    expect(pickInputs.declaredModel).toBeUndefined();
  });
});
