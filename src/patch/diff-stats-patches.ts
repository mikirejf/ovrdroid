import type { Patch } from './patches.ts';

const DIFF_STATS_METHOD =
  'async $ODstats(){' +
  'let $ODhead=await l("git",["symbolic-ref","--short","refs/remotes/origin/HEAD"]),$ODbase="HEAD";' +
  'if($ODhead.ok&&$ODhead.stdout){' +
  'let $ODfork=await l("git",["merge-base",$ODhead.stdout,"HEAD"]);' +
  '$ODbase=$ODfork.ok&&$ODfork.stdout?$ODfork.stdout:$ODhead.stdout}' +
  'let $ODdiff=await l("git",["diff","--shortstat",$ODbase,"--"]);' +
  'if(!$ODdiff.ok)return{};' +
  'let $ODadd=$ODdiff.stdout.match("([0-9]+) insertion"),$ODdel=$ODdiff.stdout.match("([0-9]+) deletion");' +
  'return{additions:$ODadd?+$ODadd[1]:0,deletions:$ODdel?+$ODdel[1]:0}}';

const NO_PR_STATS =
  'typeof f.additions=="number"&&typeof f.deletions=="number"?' +
  '[rt("+"+f.additions,{color:a.gitAdditions,bold:!0}),rt(" "),rt("-"+f.deletions,{color:a.gitDeletions,bold:!0})]:[]';

export const diffStatsPatches: readonly Patch[] = [
  {
    name: 'diff-stats-without-pr',
    find: 'return this.publish({status:"error"})}return this.lookupFailing=!1,this.lastFound=null,this.publish({status:"not-found"})}takeStaleFound(){',
    lookups: ['async function T(t){let s=await l("git",["merge-base",'],
    replace:
      'return this.publish({status:"error",...await this.$ODstats()})}' +
      'return this.lookupFailing=!1,this.lastFound=null,this.publish({status:"not-found",...await this.$ODstats()})}' +
      `${DIFF_STATS_METHOD}takeStaleFound(){`,
  },
  {
    name: 'diff-stats-footer-without-pr',
    find: 'if(f.status!=="found"||!f.prUrl||!f.prNumber)return[];',
    lookups: ['{color:a.gitAdditions,bold:!0}),rt(" "),rt('],
    replace: `if(f.status!=="found"||!f.prUrl||!f.prNumber)return ${NO_PR_STATS};`,
  },
];
