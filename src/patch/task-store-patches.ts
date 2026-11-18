import type { Patch } from './patches.ts';

export const TASK_STORE_MAX_AGE_MS = 48 * 60 * 60 * 1000;

const COMPACT_OPTION = '$ODcompact';

const PRUNE_IN_VIEW =
  '(a)=>{let d=xe(a),$ODwrote=e(d),$ODcutoff=Date.now()-' +
  `${TASK_STORE_MAX_AGE_MS},` +
  '$ODkept=d.invocations.filter(($ODe)=>$ODe.status==="pending"||$ODe.status==="running"||$ODe.updatedAt>=$ODcutoff);' +
  'if(!$ODwrote&&$ODkept.length===d.invocations.length)return!1;d.invocations=$ODkept;' +
  'return a.invocations=at(d),!0}';

const SERIALIZE = 'let l=JSON.stringify(s,null,';
const SIZE_GUARD = ';if(n?.maxBytes!==void 0)';

export const taskStorePatches: readonly Patch[] = [
  {
    name: 'task-store-prunes-old-invocations',
    find: '(a)=>{let d=xe(a);if(!e(d))return!1;return a.invocations=at(d),!0},{throwOnError:!0,',
    replace: `${PRUNE_IN_VIEW},{throwOnError:!0,${COMPACT_OPTION}:!0,`,
  },
  {
    name: 'task-store-writes-compact-json',
    find: `${SERIALIZE}2)${SIZE_GUARD}`,
    replace: `${SERIALIZE}n?.${COMPACT_OPTION}?void 0:2)${SIZE_GUARD}`,
  },
];
