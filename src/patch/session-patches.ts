import { agentBrowserPatches } from './agent-browser-patches.ts';
import { blankDiagPatches } from './blank-diag-patches.ts';
import { copyMenuPatches } from './copy-menu-patches.ts';
import type { Patch } from './patches.ts';
import { proxySessionPatches } from './proxy-session-patches.ts';
import { renderContextPatches } from './render-context-patches.ts';
import { resumeCachePatches } from './resume-cache-patches.ts';
import { sessionIndexPatches } from './session-index-patches.ts';
import { sessionListPatches } from './session-list-patches.ts';
import { sessionMentionPatches } from './session-mention-patches.ts';
import { subagentsTabPatches } from './subagents-tab-patches.ts';
import { suggestionListPatches } from './suggestion-list-patches.ts';
import { titleModelPatches } from './title-model-patches.ts';

export const sessionPatches: readonly Patch[] = [
  ...sessionIndexPatches,
  ...sessionMentionPatches,
  ...sessionListPatches,
  ...subagentsTabPatches,
  ...titleModelPatches,
  ...suggestionListPatches,
  ...resumeCachePatches,
  ...proxySessionPatches,
  ...copyMenuPatches,
  ...blankDiagPatches,
  ...renderContextPatches,
  ...agentBrowserPatches,
];
