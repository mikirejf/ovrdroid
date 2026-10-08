import { errorPatches } from './error-patches.ts';
import { hookFormatPatches } from './hook-format-patches.ts';
import type { Patch } from './patches.ts';

export const agentPatches: readonly Patch[] = [...errorPatches, ...hookFormatPatches];
