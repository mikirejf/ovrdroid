import { errorPatches } from './error-patches.ts';
import { fileTrackerPatches } from './file-tracker-patches.ts';
import type { Patch } from './patches.ts';

export const agentPatches: readonly Patch[] = [...errorPatches, ...fileTrackerPatches];
