import type { Patch } from './patches.ts';

const STALE_MATCH =
  'if(g){let C=Rt(v,M);if(C===void 0||S.length!==v.length||S.slice(C.start,C.end)!==v.slice(C.start,C.end))return y}';

export const staleEditPatches: readonly Patch[] = [
  {
    name: 'edit-refuses-stale-change-all',
    find: STALE_MATCH,
    replace: STALE_MATCH.replace('let C=Rt(v,M);', 'if(M.change_all)return y;let C=Rt(v,M);'),
  },
];
