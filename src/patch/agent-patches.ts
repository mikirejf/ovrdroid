import { errorPatches } from './error-patches.ts';
import { fileTrackerPatches } from './file-tracker-patches.ts';
import type { Patch } from './patches.ts';
import { taskStorePatches } from './task-store-patches.ts';
import { wideTerminalPatches } from './wide-terminal-patches.ts';

export const agentPatches: readonly Patch[] = [
  ...errorPatches,
  ...fileTrackerPatches,
  ...taskStorePatches,
  ...wideTerminalPatches,
];
