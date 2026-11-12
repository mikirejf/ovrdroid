import type { Patch } from './patches.ts';

const MID_CONVERSATION_GATE = 'let gr=wn!==void 0&&_Pe(o,We),';

export const customToolLoadingPatches: readonly Patch[] = [
  {
    name: 'custom-claude-deferred-tools',
    find: 'wn=!X&&he===void 0&&_t&&We?.supportsMidConversationToolChanges?uF(',
    replace: 'wn=he===void 0&&_t&&We?.supportsMidConversationToolChanges?uF(',
  },
  {
    name: 'custom-claude-deferred-tools-beta',
    find: MID_CONVERSATION_GATE,
    replace: 'let gr=wn!==void 0&&_Pe(o??"anthropic",We),',
  },
  {
    name: 'custom-claude-deferred-tools-body',
    find: '...!X?{tools:Co?bR(An):An,messages:Zo}:{}}',
    lookups: [MID_CONVERSATION_GATE],
    replace: '...!X||gr?{tools:Co?bR(An):An,messages:Zo}:{}}',
  },
];
