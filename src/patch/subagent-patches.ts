import { busySignalPatches } from './busy-signal-patches.ts';
import { droidsViewPatches } from './droids-view-patches.ts';
import type { Patch } from './patches.ts';
import { rewindPatches } from './rewind-patches.ts';
import { rewindScrollPatches } from './rewind-scroll-patches.ts';
import { sessionHistoryPatches } from './session-history-patches.ts';
import { sessionRosterPatches } from './session-roster-patches.ts';
import { subagentDetailStepsPatches } from './subagent-detail-steps-patches.ts';
import { subagentInputPatches } from './subagent-input-patches.ts';
import { subagentLaunchPatches } from './subagent-launch-patches.ts';
import { subagentModelPatches } from './subagent-model-patches.ts';

export const subagentPatches: readonly Patch[] = [
  ...subagentModelPatches,
  ...subagentLaunchPatches,
  ...subagentDetailStepsPatches,
  ...rewindPatches,
  ...rewindScrollPatches,
  ...droidsViewPatches,
  ...sessionHistoryPatches,
  ...sessionRosterPatches,
  ...busySignalPatches,
  ...subagentInputPatches,
];
