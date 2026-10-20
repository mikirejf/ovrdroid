import { contextRulesPatches } from './context-rules-patches.ts';
import { droidFrontmatterPatches } from './droid-frontmatter-patches.ts';
import { errorPatches } from './error-patches.ts';
import { fileTrackerPatches } from './file-tracker-patches.ts';
import { guidelineSymlinkPatches } from './guideline-symlink-patches.ts';
import type { Patch } from './patches.ts';
import { renderPatches } from './render-patches.ts';
import { subagentPatches } from './subagent-patches.ts';
import { taskStorePatches } from './task-store-patches.ts';
import { toolSurfacePatches } from './tool-surface-patches.ts';
import { wideTerminalPatches } from './wide-terminal-patches.ts';

export const agentPatches: readonly Patch[] = [
  ...errorPatches,
  ...fileTrackerPatches,
  ...taskStorePatches,
  ...wideTerminalPatches,
  ...renderPatches,
  ...droidFrontmatterPatches,
  ...subagentPatches,
  ...contextRulesPatches,
  ...guidelineSymlinkPatches,
  ...toolSurfacePatches,
];
