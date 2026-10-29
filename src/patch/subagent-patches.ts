import { busySignalPatches } from './busy-signal-patches.ts';
import { droidsViewPatches } from './droids-view-patches.ts';
import { nestedSubagentUiPatches } from './nested-subagent-ui-patches.ts';
import { nestingPatches } from './nesting-patches.ts';
import type { Patch } from './patches.ts';
import { rewindPatches } from './rewind-patches.ts';
import { sessionRosterPatches } from './session-roster-patches.ts';
import { subagentInputPatches } from './subagent-input-patches.ts';
import { subagentLaunchPatches } from './subagent-launch-patches.ts';
import { subagentModelPatches } from './subagent-model-patches.ts';

export const subagentPatches: readonly Patch[] = [
  ...subagentModelPatches,
  ...subagentLaunchPatches,
  ...nestingPatches,
  ...nestedSubagentUiPatches,
  ...rewindPatches,
  ...droidsViewPatches,
  ...sessionRosterPatches,
  ...busySignalPatches,
  ...subagentInputPatches,
];
