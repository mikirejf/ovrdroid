import type { Patch } from './patches.ts';
import { resumeCachePatches } from './resume-cache-patches.ts';
import { sessionIndexPatches } from './session-index-patches.ts';
import { sessionListPatches } from './session-list-patches.ts';
import { sessionMentionPatches } from './session-mention-patches.ts';
import { suggestionListPatches } from './suggestion-list-patches.ts';
import { titleModelPatches } from './title-model-patches.ts';

export const sessionPatches: readonly Patch[] = [
  ...sessionIndexPatches,
  ...sessionMentionPatches,
  ...sessionListPatches,
  ...titleModelPatches,
  ...suggestionListPatches,
  ...resumeCachePatches,
];
