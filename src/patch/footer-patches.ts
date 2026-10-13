import { diffStatsPatches } from './diff-stats-patches.ts';
import type { Patch } from './patches.ts';
import { turnClockPatches } from './turn-clock-patches.ts';

export const footerPatches: readonly Patch[] = [...turnClockPatches, ...diffStatsPatches];
