import type { Patch } from './patches.ts';

export const TASK_STORE_MAX_AGE_MS = 48 * 60 * 60 * 1000;

const COMPACT_OPTION = '$ODcompact';

const PRUNE_IN_VIEW =
  '(a)=>{let d=xe(a),$ODwrote=e(d),$ODcutoff=Date.now()-' +
  `${TASK_STORE_MAX_AGE_MS},` +
  '$ODkept=d.invocations.filter(($ODe)=>$ODe.status==="pending"||$ODe.status==="running"||$ODe.updatedAt>=$ODcutoff);' +
  'if(!$ODwrote&&$ODkept.length===d.invocations.length)return!1;d.invocations=$ODkept;' +
  'return a.invocations=at(d),!0}';

const SAVE_HEAD = `function jo(e,o,t,r){let a=\`\${e}.\${process.pid}.\${Date.now()}.tmp\`;try{let c=JSON.stringify(t,null,`;

export const taskStorePatches: readonly Patch[] = [
  {
    name: 'task-store-prunes-old-invocations',
    find: '(a)=>{let d=xe(a);if(!e(d))return!1;return a.invocations=at(d),!0},{throwOnError:!0,',
    replace: `${PRUNE_IN_VIEW},{throwOnError:!0,${COMPACT_OPTION}:!0,`,
  },
  {
    name: 'task-store-writes-compact-json',
    find: `${SAVE_HEAD}2)`,
    replace: `${SAVE_HEAD}r?.${COMPACT_OPTION}?void 0:2)`,
  },
];
