import { PICK_MODEL } from '../subagent-model-patches.ts';
import { payloadFunction } from './payload.ts';
import type { Launch } from './subagent-model-harness.ts';
import { HAIKU, isKnown, KNOWN, OPUS, SONNET } from './subagent-model-harness.ts';

export interface Selection {
  modelId?: string | undefined;
  reasoningEffort?: string | undefined;
  complexity?: string | undefined;
  $ODtoolModel?: string | undefined;
}

interface Tier {
  model?: string;
  effort?: string;
}

export interface Subagent {
  name: string;
  custom: boolean;
  fixedModel?: string;
  declaredModel?: string | undefined;
  effort?: string;
  tiers?: Partial<Record<'light' | 'medium' | 'heavy', Tier>>;
}

export interface PickInputs extends Subagent {
  stock: (tier?: string) => Selection;
  parent: () => Selection;
  lower: (model: string, tier: string, inherited?: string) => string;
  clamp: (model: string, effort: string) => string;
  valid: (id: string) => boolean;
  ids: () => readonly string[];
}

export const pick = payloadFunction<[], (launch: Launch, inputs: PickInputs) => Selection>(
  [],
  `${PICK_MODEL}return $ODpick`,
)();

export const PARENT: Selection = { modelId: HAIKU, reasoningEffort: 'medium' };
export const STOCK_MARK: Selection = { modelId: 'stock-path', reasoningEffort: 'stock-path' };
export const HIGH_ONLY = 'custom:droidproxy:high-only';

function clamp(model: string, effort: string): string {
  return model === HIGH_ONLY && effort !== 'minimal' && effort !== 'low' ? 'high' : effort;
}

export function stockOf(subagent: Subagent): (tier?: string) => Selection {
  return (tier) => {
    if (subagent.custom) {
      return subagent.fixedModel === undefined
        ? PARENT
        : { modelId: subagent.fixedModel, reasoningEffort: subagent.effort };
    }
    return {
      ...PARENT,
      reasoningEffort: tier === 'light' ? 'off' : 'medium',
      complexity: tier ?? 'medium',
    };
  };
}

export function inputsOf(subagent: Subagent): PickInputs {
  return {
    ...subagent,
    declaredModel: subagent.declaredModel ?? subagent.fixedModel,
    stock: stockOf(subagent),
    parent: () => PARENT,
    lower: (_model, tier) => (tier === 'light' ? 'off' : 'medium'),
    clamp,
    valid: isKnown,
    ids: () => KNOWN,
  };
}

export function resolve(launch: Launch, subagent: Subagent): Selection {
  return pick(launch, inputsOf(subagent));
}

export const POTETO: Subagent = {
  name: 'poteto-agent',
  custom: true,
  effort: 'high',
  tiers: { light: { effort: 'low' }, medium: { effort: 'high' }, heavy: { effort: 'xhigh' } },
};

export const TIERED: Subagent = {
  name: 'tiered',
  custom: true,
  tiers: { light: { model: SONNET, effort: 'low' }, heavy: { model: OPUS, effort: 'xhigh' } },
};

export const CODER_MEDIUM: Subagent = {
  name: 'coder-medium',
  custom: true,
  fixedModel: SONNET,
  effort: 'high',
};

export const PLAIN_INHERIT: Subagent = { name: 'generalPurpose', custom: true };
export const WORKER: Subagent = { name: 'worker', custom: false };
