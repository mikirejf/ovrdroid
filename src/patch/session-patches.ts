import type { Patch } from './patches.ts';
import { sessionIndexPatches } from './session-index-patches.ts';
import { sessionMentionPatches } from './session-mention-patches.ts';
import { titleModelPatches } from './title-model-patches.ts';

export const sessionPatches: readonly Patch[] = [
  ...sessionIndexPatches,
  ...sessionMentionPatches,
  ...titleModelPatches,
];
