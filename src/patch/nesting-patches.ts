import type { Patch } from './patches.ts';

export const NESTING_CEILING = 3;
export const DEFAULT_MAX_DEPTH = 2;
export const DEFAULT_DESCENDANTS_PER_ROOT = 25;
export const DEFAULT_SUBAGENTS_PER_DAEMON = 100;

export const NEST_CAP =
  'function $ODnestCap($ODv,$ODd,$ODmax=1/0){return Number.isInteger($ODv)&&$ODv>0&&$ODv<=$ODmax?$ODv:$ODd}';

export const MAY_NEST =
  'function $ODmayNest($ODl,$ODm,$ODc){return $ODl===0||$ODl<Math.min($ODm??1,$ODc)}';

export const NEST_REFUSAL =
  'function $ODnestRefusal($ODr,$ODl,$ODc){let $ODn=$ODr?.subagentType??"This subagent",$ODm=$ODr?.maxDepth,' +
  `$ODwhy=$ODm!==void 0&&$ODm>$ODl?\`, but Droid allows subagents only down to level \${$ODc}, so it cannot launch a subagent\`:". A subagent may launch subagents only when its maxDepth is greater than its level, so it cannot launch one";` +
  `return\`\${$ODn} runs at level \${$ODl} and its maxDepth is \${$ODm??1}\${$ODm===void 0?" (the default)":""}\${$ODwhy}. Complete this work yourself instead of delegating further.\`}`;

const STOCK_GATES =
  'function o6(){let t=oo(Z1)??Ym;return{maxDepth:Math.min(t.max_depth,j6),maxActiveDescendantsPerRoot:t.max_active_descendants_per_root}}' +
  'function a6(){if(!U(M.NestedTaskDelegation))return!1;let t=m();if(t.isSpecMode())return!1;let o=t.getCurrentSessionId();if(!o)return!1;' +
  'try{let a=$z(o),c=o6();if(a.lineage.depth===0)return!1;return a.lineage.depth<c.maxDepth}' +
  'catch(a){return n("Nested Task availability check failed; disabling delegation",{sessionId:o,cause:a}),!1}}' +
  'function kTe(t){if(!hn(t.parentSessionId))return;let o;try{o=$z(t.parentSessionId).lineage.depth}' +
  'catch(a){return n("Nested Task scope check failed; rejecting call",{sessionId:t.parentSessionId,cause:a}),"over_depth"}' +
  'if(o===0)return;if(!U(M.NestedTaskDelegation)||o>=o6().maxDepth)return"over_depth";return}';

const PATCHED_GATES =
  `${NEST_CAP}${MAY_NEST}${NEST_REFUSAL}` +
  'function o6(){let $ODn=C().settings.general?.nestedTaskDelegation;' +
  `return{maxDepth:$ODnestCap($ODn?.maxDepth,${DEFAULT_MAX_DEPTH},j6),maxActiveDescendantsPerRoot:$ODnestCap($ODn?.maxActiveDescendantsPerRoot,${DEFAULT_DESCENDANTS_PER_ROOT})}}` +
  'function a6(){let t=m();if(t.isSpecMode())return!1;let o=t.getCurrentSessionId();if(!o)return!1;' +
  'try{let a=$z(o).lineage.depth;return a>0&&$ODmayNest(a,hn(o)?.maxDepth,o6().maxDepth)}' +
  'catch(a){return n("Nested Task availability check failed; disabling delegation",{sessionId:o,cause:a}),!1}}' +
  'function kTe(t){let $ODr=hn(t.parentSessionId);if(!$ODr)return;let o;try{o=$z(t.parentSessionId).lineage.depth}' +
  'catch(a){return n("Nested Task scope check failed; rejecting call",{sessionId:t.parentSessionId,cause:a}),"over_depth"}' +
  'let $ODc=o6().maxDepth;return $ODmayNest(o,$ODr.maxDepth,$ODc)?void 0:$ODnestRefusal($ODr,o,$ODc)}';

const STOCK_SCOPE_VIOLATION =
  'switch(t){case"over_depth":default:return{llmError:"Nested Task delegation has reached its maximum depth.';

const STOCK_DAEMON_SLOT =
  'reserveTaskSubagentSlotIfEligible(t,o){if(!U(M.NestedTaskDelegation)||!o&&!nd(t))return;let a=oo(Z1)??Ym;' +
  'return this.droidRegistry.reserveTaskSubagentSlot(a.max_active_task_subagents_per_daemon)}';

const PATCHED_DAEMON_SLOT =
  `reserveTaskSubagentSlotIfEligible(t,o){${NEST_CAP}if(!o&&!nd(t))return;let $ODs;` +
  'try{$ODs=globalThis.Bun.JSONC.parse(O.readFileSync(F.join(L(),w(),"settings.json"),"utf-8"))?.nestedTaskDelegation}catch{}' +
  `return this.droidRegistry.reserveTaskSubagentSlot($ODnestCap($ODs?.maxActiveTaskSubagentsPerDaemon,${DEFAULT_SUBAGENTS_PER_DAEMON}))}`;

const STOCK_LEDGER_ADMISSION =
  'completionEvidenceVersion:x?iJ:1};if(U(M.NestedTaskDelegation))G=await _Re(K,o6());else G=await Qz(K)}';

const TASK_CONFIG_TAIL =
  'structuredOutputFormat:t.outputFormat}}static async listAvailableSubagents(){';

export const nestingPatches: readonly Patch[] = [
  {
    name: 'nesting-depth-ceiling',
    find: 'eS={max_depth:1,max_active_descendants_per_root:25,',
    replace: `eS={max_depth:${NESTING_CEILING},max_active_descendants_per_root:25,`,
  },
  {
    name: 'nesting-gates-read-the-droid-max-depth',
    find: STOCK_GATES,
    lookups: ['function rs(t){let o=C().getBuiltInToolAutonomyOverrides()'],
    replace: PATCHED_GATES,
  },
  {
    name: 'nesting-refusal-names-the-droid',
    find: STOCK_SCOPE_VIOLATION,
    replace: `if(t!=="over_depth")return{llmError:t,userError:t};${STOCK_SCOPE_VIOLATION}`,
  },
  {
    name: 'nesting-task-config-carries-max-depth',
    find: TASK_CONFIG_TAIL,
    lookups: ['R=v.type==="custom"?v.droid:Ele(v.config)'],
    replace: TASK_CONFIG_TAIL.replace(
      't.outputFormat}}',
      't.outputFormat,maxDepth:R.metadata.maxDepth}}',
    ),
  },
  {
    name: 'nesting-ledger-records-max-depth',
    find: STOCK_LEDGER_ADMISSION,
    lookups: [
      'E=t,T=lp({parentSessionId:g,parentToolUseId:f}),v=pp(o,a),R=t.isResume?hn(t.sessionId):void 0',
    ],
    replace:
      'completionEvidenceVersion:x?iJ:1,maxDepth:E.maxDepth??R?.maxDepth};G=await _Re(K,o6())}',
  },
  {
    name: 'nesting-daemon-cap-from-settings',
    find: STOCK_DAEMON_SLOT,
    lookups: [
      `static sessionFileExists(t){let o=F.join(L(),w(),"sessions"),a=F.join(o,\`\${t}.jsonl\`);if(O.existsSync(a))`,
    ],
    replace: PATCHED_DAEMON_SLOT,
  },
];
