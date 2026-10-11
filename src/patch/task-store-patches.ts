import type { Patch } from './patches.ts';

export const TASK_STORE_MAX_AGE_MS = 48 * 60 * 60 * 1000;

const COMPACT_OPTION = '$ODcompact';

const PRUNE =
  '($ODstore)=>{let $ODwrote=t($ODstore),$ODcutoff=Date.now()-' +
  `${TASK_STORE_MAX_AGE_MS},` +
  '$ODkept=$ODstore.invocations.filter(($ODe)=>$ODe.status==="pending"||$ODe.status==="running"||($ODe.updatedAt??$ODe.createdAt)>=$ODcutoff);' +
  'if($ODkept.length===$ODstore.invocations.length)return $ODwrote;$ODstore.invocations=$ODkept;return!0}';

const SAVE_HEAD =
  `function Va(r,t,e,o){let a=\`\${r}.\${process.pid}.\${Date.now()}.tmp\`;try{let s=y.dirname(r);` +
  'if(!l.existsSync(s))l.mkdirSync(s,{recursive:!0,mode:448});if(l.writeFileSync(a,JSON.stringify(e,null,';

export const taskStorePatches: readonly Patch[] = [
  {
    name: 'task-store-prunes-old-invocations',
    find: 'await Rd(o,s,X,N,t,{throwOnError:!0,...e?.signal&&{lock:{signal:e.signal}}})',
    replace: `await Rd(o,s,X,N,${PRUNE},{throwOnError:!0,${COMPACT_OPTION}:!0,...e?.signal&&{lock:{signal:e.signal}}})`,
  },
  {
    name: 'task-store-writes-compact-json',
    find: `${SAVE_HEAD}2)`,
    replace: `${SAVE_HEAD}o?.${COMPACT_OPTION}?void 0:2)`,
  },
];
