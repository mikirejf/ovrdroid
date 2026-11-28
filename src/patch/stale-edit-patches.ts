import type { Patch } from './patches.ts';

export const STALE_EDIT_NOTE =
  "This file's modification time changed after you last read it, so its contents may differ from that Read. old_str still matched exactly once in the current contents, so the edit was applied there. Read the file again before an edit that depends on its other contents.";

const STALE_MATCH =
  'if(g){let C=Rt(v,M);if(C===void 0||S.length!==v.length||S.slice(C.start,C.end)!==v.slice(C.start,C.end))return y}';

export const staleEditPatches: readonly Patch[] = [
  {
    name: 'edit-refuses-stale-change-all',
    find: STALE_MATCH,
    replace: STALE_MATCH.replace('let C=Rt(v,M);', 'if(M.change_all)return y;let C=Rt(v,M);'),
  },
];
