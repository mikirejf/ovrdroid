import type { Patch } from './patches.ts';

const DIFF_STATS_METHOD =
  'async $ODstats($ODcwd){' +
  'let $ODhead=await f($ODcwd,"git",["symbolic-ref","--short","refs/remotes/origin/HEAD"]),$ODbase="HEAD";' +
  'if($ODhead.ok&&$ODhead.stdout){' +
  'let $ODfork=await f($ODcwd,"git",["merge-base",$ODhead.stdout,"HEAD"]);' +
  '$ODbase=$ODfork.ok&&$ODfork.stdout?$ODfork.stdout:$ODhead.stdout}' +
  'let $ODdiff=await f($ODcwd,"git",["diff","--shortstat",$ODbase,"--"]);' +
  'if(!$ODdiff.ok)return{};' +
  'let $ODadd=$ODdiff.stdout.match("([0-9]+) insertion"),$ODdel=$ODdiff.stdout.match("([0-9]+) deletion");' +
  'return{additions:$ODadd?+$ODadd[1]:0,deletions:$ODdel?+$ODdel[1]:0}}';

const PUBLISH_WITH_STATS_METHOD =
  'async $ODpublishWithStats($ODstate,$ODcwd){' +
  'let $ODrun=this.pendingDetection;' +
  'if($ODstate.status!=="found"){' +
  'let $ODcounts=await this.$ODstats($ODcwd);' +
  'if(this.pendingDetection!==$ODrun)return this.state;' +
  '$ODstate={...$ODstate,...$ODcounts}}' +
  'return this.publish($ODstate,$ODcwd)}';

const NO_PR_STATS =
  'typeof f.additions=="number"&&typeof f.deletions=="number"?' +
  '[rt("+"+f.additions,{color:a.gitAdditions,bold:!0}),rt(" "),rt("-"+f.deletions,{color:a.gitDeletions,bold:!0})]:[]';

export const diffStatsPatches: readonly Patch[] = [
  {
    name: 'diff-stats-without-pr',
    find: 'return this.lookupFailing=!0,this.publish(this.takeStaleFound(t)??{status:"error"},t);case"absent":return this.lookupFailing=!1,this.lastFound=null,this.publish({status:"not-found"},t);default:return re(s)}}takeStaleFound(',
    lookups: ['await f(u,"git",["diff","--shortstat",'],
    replace:
      'return this.lookupFailing=!0,this.$ODpublishWithStats(this.takeStaleFound(t)??{status:"error"},t);' +
      'case"absent":return this.lookupFailing=!1,this.lastFound=null,this.$ODpublishWithStats({status:"not-found"},t);' +
      `default:return re(s)}}${PUBLISH_WITH_STATS_METHOD}${DIFF_STATS_METHOD}takeStaleFound(`,
  },
  {
    name: 'diff-stats-footer-without-pr',
    find: 'if(f.status!=="found"||!f.prUrl||!f.prNumber)return[];',
    lookups: ['{color:a.gitAdditions,bold:!0}),rt(" "),rt('],
    replace: `if(f.status!=="found"||!f.prUrl||!f.prNumber)return ${NO_PR_STATS};`,
  },
];
