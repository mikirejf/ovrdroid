import { bodyPatches } from '../patch/body-patches.ts';
import { counterPatches } from '../patch/counter-patches.ts';
import { heapPatches } from '../patch/heap-patches.ts';
import { lagPatches } from '../patch/lag-patches.ts';
import type { Patch } from '../patch/patches.ts';
import { timerPatches } from '../patch/timer-patches.ts';
import { modulePatches, tracePatches } from '../patch/trace-patches.ts';
import { watchPatches } from '../patch/watch-patches.ts';

export const PROBE_PATCH_SETS = {
  trace: tracePatches,
  modules: modulePatches,
  watch: watchPatches,
  timers: timerPatches,
  bodies: bodyPatches,
  counters: counterPatches,
  heap: heapPatches,
  lag: lagPatches,
} satisfies Record<string, readonly Patch[]>;

type ProbePatchSet = keyof typeof PROBE_PATCH_SETS;

export type ChosenSets = Partial<Record<ProbePatchSet, boolean>>;

function isProbePatchSet(name: string): name is ProbePatchSet {
  return Object.hasOwn(PROBE_PATCH_SETS, name);
}

export function chosenSets(chosen: ChosenSets): Patch[] {
  return Object.keys(PROBE_PATCH_SETS)
    .filter((name) => isProbePatchSet(name))
    .filter((name) => chosen[name] === true)
    .flatMap((name) => PROBE_PATCH_SETS[name]);
}
