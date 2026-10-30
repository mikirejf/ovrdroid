import type { Patch } from './patches.ts';

const EFFORT_GATE =
  ',ht=yt!==void 0&&We?.supportsMidConversationEffortChanges===!0&&o==="anthropic"';
const MID_CONVERSATION_GATE = `let gr=wn!==void 0&&_Pe(o,We)${EFFORT_GATE}`;

export const customToolLoadingPatches: readonly Patch[] = [
  {
    name: 'custom-claude-deferred-tools',
    find: 'wn=!X&&he===void 0&&_t&&We?.supportsMidConversationToolChanges?uF(',
    replace: 'wn=he===void 0&&_t&&We?.supportsMidConversationToolChanges?uF(',
  },
  {
    name: 'custom-claude-deferred-tools-beta',
    find: MID_CONVERSATION_GATE,
    replace: `let gr=wn!==void 0&&_Pe(o??"anthropic",We)${EFFORT_GATE}`,
  },
  {
    name: 'custom-claude-deferred-tools-body',
    find: '...!X?{tools:Co?bR(An):An,messages:Zo}:{}}',
    lookups: [MID_CONVERSATION_GATE],
    replace: '...!X||gr?{tools:Co?bR(An):An,messages:Zo}:{}}',
  },
];
