import { describe, expect, test } from 'bun:test';

import {
  REFUSE_RESUME_FIELDS,
  subagentModelPatches,
  TASK_HELPERS,
} from '../subagent-model-patches.ts';
import { failureOf, patchNamed, payloadFunction } from './payload.ts';
import { isKnown, KNOWN, OPUS } from './subagent-model-harness.ts';

interface TaskCall {
  subagent_type: string;
  resume?: string;
  readonly?: boolean;
  model?: string;
  effort?: string;
  complexity?: string;
}

const refuseResumeFields = payloadFunction<[], (call: TaskCall) => void>(
  [],
  `${REFUSE_RESUME_FIELDS}return $ODresume`,
)();

const RESUME_EXTRAS = [
  ['model', { model: OPUS }],
  ['effort', { effort: 'high' }],
  ['complexity', { complexity: 'heavy' }],
] as const;

describe('a resume refuses the fields that only a new launch uses', () => {
  const resumed: TaskCall = { subagent_type: 'poteto-agent', resume: 'abc' };

  test('a resume without them goes through, readonly false included', () => {
    expect(() => {
      refuseResumeFields(resumed);
    }).not.toThrow();
    expect(() => {
      refuseResumeFields({ ...resumed, readonly: false });
    }).not.toThrow();
  });

  test('readonly true is refused, and the error says the tools stay as they were', () => {
    expect(() => {
      refuseResumeFields({ ...resumed, readonly: true });
    }).toThrow(
      'readonly applies only to a new launch, so it cannot be combined with resume. The resumed subagent keeps the tools it started with',
    );
  });

  test.each(RESUME_EXTRAS)('%s is refused, and the error names it', (field, extra) => {
    expect(() => {
      refuseResumeFields({ ...resumed, ...extra });
    }).toThrow(
      `${field} applies only to a new launch, so it cannot be combined with resume. The resumed subagent keeps the model and effort it started with. Resume without ${field}`,
    );
  });

  test('a new launch is never refused', () => {
    expect(() => {
      refuseResumeFields({
        subagent_type: 'poteto-agent',
        readonly: true,
        model: OPUS,
        effort: 'high',
        complexity: 'heavy',
      });
    }).not.toThrow();
  });
});

interface Droid {
  metadata: { name: string };
}

interface LaunchResult {
  kind: 'launch' | 'resume';
  droids: readonly Droid[];
  type: string;
}

type Launcher = (call: TaskCall) => Promise<LaunchResult>;

const STOCK_LAUNCHER =
  'static async buildStreamJsonRpcTaskConfig(t,o,a){' +
  'if(t.resume){let Q=await Do().loadAllDroids(),ge=hn(t.resume)?.subagentType;return{kind:"resume",droids:Q,type:t.subagent_type}}' +
  'let{subagent_type:l}=t,y=await Do().loadAllDroids(),S=o?.sessionExecutionContext;return{kind:"launch",droids:y,type:l}}';

const LAUNCHER_PATCHES = [
  'task-launch-splits-model-and-matches-name',
  'task-resume-reuses-the-loaded-droids',
  'task-launch-reuses-the-loaded-droids',
];

function patchedSource(): string {
  let source = STOCK_LAUNCHER;
  for (const name of LAUNCHER_PATCHES) {
    const patch = patchNamed(subagentModelPatches, name);
    if (!source.includes(patch.find)) {
      throw new TypeError(`${name} does not match the stand-in launcher`);
    }
    source = source.replace(patch.find, () => patch.replace);
  }
  return source;
}

interface Registry {
  loadAllDroids: () => Promise<readonly Droid[]>;
}

interface ModelTools {
  validateModel: (id: string) => { valid: boolean };
}

interface Settings {
  getCustomModels: () => string[];
}

const MODEL_TOOLS: ModelTools = { validateModel: (id) => ({ valid: isKnown(id) }) };
const SETTINGS: Settings = { getCustomModels: () => [] };

const makeLauncher = payloadFunction<
  [
    () => Registry,
    () => null,
    ModelTools,
    () => string[],
    () => { name: string }[],
    () => Settings,
  ],
  { buildStreamJsonRpcTaskConfig: Launcher }
>(['Do', 'hn', 'vi', 'Cs', 'oO', 'C'], `${TASK_HELPERS}return class{${patchedSource()}}`);

function launcherOf(counter: { loads: number }, droids: readonly Droid[]): Launcher {
  const registry: Registry = {
    loadAllDroids: async () => {
      await Promise.resolve();
      counter.loads += 1;
      return droids;
    },
  };
  return makeLauncher(
    () => registry,
    () => null,
    MODEL_TOOLS,
    () => [...KNOWN],
    () => [{ name: 'worker' }],
    () => SETTINGS,
  ).buildStreamJsonRpcTaskConfig;
}

describe('the Task launcher loads the droid registry once per call', () => {
  const droids = [{ metadata: { name: 'poteto-agent' } }];

  test('a new launch loads it once, and the loose name match uses that load', async () => {
    const registry = { loads: 0 };
    const result = await launcherOf(registry, droids)({ subagent_type: 'Poteto Agent' });
    expect(registry.loads).toBe(1);
    expect(result).toMatchObject({ kind: 'launch', type: 'poteto-agent', droids });
  });

  test('a resume loads it once', async () => {
    const registry = { loads: 0 };
    const result = await launcherOf(
      registry,
      droids,
    )({
      subagent_type: 'Poteto Agent',
      resume: 'abc',
    });
    expect(registry.loads).toBe(1);
    expect(result).toMatchObject({ kind: 'resume', type: 'poteto-agent', droids });
  });

  test('a resume with readonly is refused before anything loads', async () => {
    const registry = { loads: 0 };
    const message = await failureOf(
      launcherOf(
        registry,
        droids,
      )({ subagent_type: 'poteto-agent', resume: 'abc', readonly: true }),
    );
    expect(message).toContain('readonly applies only to a new launch');
    expect(registry.loads).toBe(0);
  });

  test.each(RESUME_EXTRAS)('a resume with %s is refused', async (field, extra) => {
    const message = await failureOf(
      launcherOf({ loads: 0 }, droids)({ subagent_type: 'poteto-agent', resume: 'abc', ...extra }),
    );
    expect(message).toContain(`${field} applies only to a new launch`);
  });
});
