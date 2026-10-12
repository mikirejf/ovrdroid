import { describe, expect, test } from 'bun:test';

import { subagentLaunchPatches } from '../subagent-launch-patches.ts';
import { patchNamed, payloadFunction } from './payload.ts';
import { SONNET } from './subagent-model-harness.ts';

const HIDDEN = 'TodoWrite';
const READ_ONLY = ['Read', 'Grep', 'Glob', 'Execute', 'Skill', HIDDEN];
const EVERYTHING = [...READ_ONLY, 'Edit', 'Create', 'ApplyPatch', 'Task'];

interface FakeDroid {
  metadata: { tools: string[] | 'read-only' | undefined; model?: string };
}

interface FakeTools {
  expandTools: (options: { tools: string[] | 'read-only' | undefined; model: string }) => string[];
  $ODdroidTools: (droid: FakeDroid, model: string) => string[];
  usesReadOnlyPolicy: (tools: unknown) => boolean;
}

interface Picked {
  modelId?: string;
  $ODtoolModel?: string;
}

interface PickInputs {
  fixedModel: string | undefined;
  declaredModel: string | undefined;
}

type Pick = (launch: unknown, inputs: PickInputs) => Picked;

interface LaunchRun {
  tools: string[];
  restricted: boolean;
  readOnlyPolicy: boolean;
  modelId: string | undefined;
}

interface Launched extends LaunchRun {
  pickInputs: PickInputs;
}

const GPT = 'custom:gpt-5';
const EDIT_TOOLS = new Set(['Edit', 'Create', 'ApplyPatch']);

function listFor(tools: string[] | 'read-only' | undefined): string[] {
  if (tools === 'read-only') {
    return READ_ONLY;
  }
  return tools === undefined ? EVERYTHING : [...new Set([...tools, HIDDEN])];
}

function expandedFor(tools: string[] | 'read-only' | undefined, model: string): string[] {
  const base = listFor(tools);
  if (!base.some((id) => EDIT_TOOLS.has(id)) || (model !== GPT && model !== SONNET)) {
    return base;
  }
  const rest = base.filter((id) => !EDIT_TOOLS.has(id));
  return model === GPT ? [...rest, 'ApplyPatch'] : [...rest, 'Edit', 'Create'];
}

function toolsOf(events: string[]): FakeTools {
  const expandTools: FakeTools['expandTools'] = ({ tools, model }) => {
    events.push(`expand:${model}`);
    return expandedFor(tools, model);
  };
  return {
    expandTools,
    $ODdroidTools: (droid, model) => expandTools({ tools: droid.metadata.tools, model }),
    usesReadOnlyPolicy: (tools) => tools === 'read-only',
  };
}

function patched(name: string): string {
  return patchNamed(subagentLaunchPatches, name).replace;
}

const run = payloadFunction<
  [{ readonly: boolean | undefined }, FakeDroid, FakeTools, string | undefined, Pick],
  LaunchRun
>(
  ['t', 'R', 'vi', 'F', '$ODpick'],
  `let $ODl,o,A,lw,Ie,$ODids=()=>[],v={type:"custom"},${patched('task-launch-picks-model-then-expands-tools')},` +
    `${patched('task-readonly-applies-read-only-policy')},${patched('task-readonly-restricts-enabled-tools')};` +
    'return{tools:_,restricted:ye,readOnlyPolicy:V,modelId:O}',
);

interface LaunchOptions {
  droidModel?: string;
  declaredModel?: string;
  picked?: Picked;
  events?: string[];
}

function launchTools(
  readonly: boolean | undefined,
  tools?: string[] | 'read-only',
  options: LaunchOptions = {},
): Launched {
  const events = options.events ?? [];
  const metadata: FakeDroid['metadata'] = { tools };
  if (options.declaredModel !== undefined) {
    metadata.model = options.declaredModel;
  }
  let seen: PickInputs | undefined;
  const result = run(
    { readonly },
    { metadata },
    toolsOf(events),
    options.droidModel,
    (_launch, inputs) => {
      events.push('pick');
      seen = inputs;
      return options.picked ?? {};
    },
  );
  if (seen === undefined) {
    throw new TypeError('the launcher never called the pick');
  }
  return { ...result, pickInputs: seen };
}

describe('readonly on a launch applies the explorer read-only policy', () => {
  test('a droid with no tool list keeps only the read-only tools', () => {
    const result = launchTools(true);
    expect(result.tools).toEqual(READ_ONLY);
    expect(result.restricted).toBe(true);
    expect(result.readOnlyPolicy).toBe(true);
  });

  test('a droid with its own tool list keeps the read-only tools it already had', () => {
    const result = launchTools(true, ['Read', 'Edit', 'Create', 'Task']);
    expect(result.tools).toEqual(['Read', HIDDEN]);
    expect(result.restricted).toBe(true);
  });

  test('a droid that lists only edit tools ends with the hidden tools alone, and the list still applies', () => {
    const result = launchTools(true, ['Edit', 'Create']);
    expect(result.tools).toEqual([HIDDEN]);
    expect(result.restricted).toBe(true);
    expect(result.readOnlyPolicy).toBe(true);
  });

  test('a droid that is already read-only stays the same', () => {
    expect(launchTools(true, 'read-only').tools).toEqual(READ_ONLY);
  });

  test.each([
    ['absent', undefined],
    ['false', false],
  ])('readonly %s changes nothing for a droid with no tool list', (_label, readonly) => {
    const result = launchTools(readonly);
    expect(result.tools).toEqual(EVERYTHING);
    expect(result.restricted).toBe(false);
    expect(result.readOnlyPolicy).toBe(false);
  });

  test.each([
    ['absent', undefined],
    ['false', false],
  ])('readonly %s changes nothing for a droid with its own tool list', (_label, readonly) => {
    const result = launchTools(readonly, ['Read', 'Edit']);
    expect(result.tools).toEqual(['Read', 'Edit', HIDDEN]);
    expect(result.restricted).toBe(true);
    expect(result.readOnlyPolicy).toBe(false);
  });
});

describe('the tools are expanded for the model the launch ends up on', () => {
  test('the model is picked before the tools are expanded', () => {
    const events: string[] = [];
    launchTools(undefined, undefined, { droidModel: SONNET, events, picked: { modelId: SONNET } });
    expect(events).toEqual(['pick', `expand:${SONNET}`]);
  });

  test('an inherit droid launched on a GPT model gets ApplyPatch, not Edit and Create', () => {
    const { tools, modelId } = launchTools(undefined, undefined, {
      picked: { modelId: GPT, $ODtoolModel: GPT },
    });
    expect(modelId).toBe(GPT);
    expect(tools).toContain('ApplyPatch');
    expect(tools).not.toContain('Edit');
    expect(tools).not.toContain('Create');
  });

  test('a launch model that moves to the Sonnet family swaps ApplyPatch for Edit and Create', () => {
    const { tools } = launchTools(undefined, undefined, {
      droidModel: GPT,
      picked: { modelId: SONNET, $ODtoolModel: SONNET },
    });
    expect(tools).toContain('Edit');
    expect(tools).toContain('Create');
    expect(tools).not.toContain('ApplyPatch');
  });

  test('a read-only launch expands both lists for the final model', () => {
    const events: string[] = [];
    launchTools(true, ['Read', 'Edit'], {
      droidModel: SONNET,
      events,
      picked: { modelId: GPT, $ODtoolModel: GPT },
    });
    expect(events.filter((event) => event.startsWith('expand:'))).toEqual([
      `expand:${GPT}`,
      `expand:${GPT}`,
    ]);
  });

  test('a model the pick left alone expands exactly as stock does, for the droid file model', () => {
    const events: string[] = [];
    const { tools } = launchTools(undefined, ['Read', 'Edit'], {
      droidModel: SONNET,
      events,
      picked: { modelId: SONNET },
    });
    expect(tools).toEqual(expandedFor(['Read', 'Edit'], SONNET));
    expect(events).toEqual(['pick', `expand:${SONNET}`]);
  });

  test('a pick that chose the droid model changes nothing', () => {
    const stockTools = launchTools(undefined, undefined, { droidModel: SONNET }).tools;
    const picked = launchTools(undefined, undefined, {
      droidModel: SONNET,
      picked: { modelId: SONNET, $ODtoolModel: SONNET },
    }).tools;
    expect(picked).toEqual(stockTools);
  });

  test('an inherit droid keeps the inherit expansion, whatever model the parent runs', () => {
    const events: string[] = [];
    const { tools } = launchTools(undefined, undefined, { events, picked: { modelId: GPT } });
    expect(tools).toEqual(EVERYTHING);
    expect(events).toEqual(['pick', 'expand:inherit']);
  });
});

describe('the pick is told which model the droid file declares', () => {
  test('a declared id counts even when the session fell back to inherit', () => {
    const { pickInputs } = launchTools(undefined, undefined, {
      declaredModel: SONNET,
      droidModel: 'inherit',
    });
    expect(pickInputs).toMatchObject({ declaredModel: SONNET, fixedModel: undefined });
  });

  test('a declared id that resolves is both declared and fixed', () => {
    const { pickInputs } = launchTools(undefined, undefined, {
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
  ])('%s declares nothing', (_label, declaredModel) => {
    const options: LaunchOptions = declaredModel === undefined ? {} : { declaredModel };
    expect(launchTools(undefined, undefined, options).pickInputs.declaredModel).toBeUndefined();
  });
});
