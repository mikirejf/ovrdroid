import { linkColorPatches } from './link-color-patches.ts';
import type { Patch } from './patches.ts';
import { shimmerPatches } from './shimmer-patches.ts';

export const colorPatches: readonly Patch[] = [...shimmerPatches, ...linkColorPatches];
