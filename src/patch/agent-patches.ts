import { contextRulesPatches } from './context-rules-patches.ts';
import { droidFrontmatterPatches } from './droid-frontmatter-patches.ts';
import { errorPatches } from './error-patches.ts';
import { fileTrackerPatches } from './file-tracker-patches.ts';
import { guidelineSymlinkPatches } from './guideline-symlink-patches.ts';
import { nestingPatches } from './nesting-patches.ts';
import type { Patch } from './patches.ts';
import { renderPatches } from './render-patches.ts';
import { subagentLaunchPatches } from './subagent-launch-patches.ts';
import { subagentModelPatches } from './subagent-model-patches.ts';
import { taskStorePatches } from './task-store-patches.ts';
import { wideTerminalPatches } from './wide-terminal-patches.ts';

export const agentPatches: readonly Patch[] = [
  ...errorPatches,
  ...fileTrackerPatches,
  ...taskStorePatches,
  ...wideTerminalPatches,
  ...renderPatches,
  ...droidFrontmatterPatches,
  ...subagentModelPatches,
  ...subagentLaunchPatches,
  ...nestingPatches,
  ...contextRulesPatches,
  ...guidelineSymlinkPatches,
];
