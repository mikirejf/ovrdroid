import { nestedSubagentUiPatches } from './nested-subagent-ui-patches.ts';
import { nestingPatches } from './nesting-patches.ts';
import type { Patch } from './patches.ts';
import { rewindPatches } from './rewind-patches.ts';
import { subagentLaunchPatches } from './subagent-launch-patches.ts';
import { subagentModelPatches } from './subagent-model-patches.ts';

export const subagentPatches: readonly Patch[] = [
  ...subagentModelPatches,
  ...subagentLaunchPatches,
  ...nestingPatches,
  ...nestedSubagentUiPatches,
  ...rewindPatches,
];
