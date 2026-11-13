import { OVRDROID_UNDER_HOME } from '../paths.ts';
import type { Patch } from './patches.ts';

export const BLANK_LOG_FILE = 'blank-diag.jsonl';

export const SCOPED_READS_PER_SECOND = 5;

export const SAME_STACK_QUIET_MS = 60_000;

export const CAUSE_WINDOW_MS = 1000;

export const StackMode = { None: 0, Always: 1, Throttled: 2 } as const;

type StackMode = (typeof StackMode)[keyof typeof StackMode];

export const STACK_FRAMES_CAPTURED = 200;

export const STACK_HEAD_FRAMES = 12;

export const STACK_TAIL_FRAMES = 20;

const STACK =
  `let $ODlimit=Error.stackTraceLimit;Error.stackTraceLimit=${STACK_FRAMES_CAPTURED};` +
  'let $ODall=(new Error().stack??"").split("\\n").slice(2).map(($ODl)=>$ODl.trim());' +
  'Error.stackTraceLimit=$ODlimit;' +
  `$ODstack=($ODall.length>${STACK_HEAD_FRAMES + STACK_TAIL_FRAMES}?[...$ODall.slice(0,${STACK_HEAD_FRAMES}),"... "+($ODall.length-${STACK_HEAD_FRAMES + STACK_TAIL_FRAMES})+" frames ...",...$ODall.slice(-${STACK_TAIL_FRAMES})]:$ODall).join("\\n");`;

const THROTTLE = `if((($ODnow/1e3)|0)!==$ODsec)$ODsec=($ODnow/1e3)|0,$ODleft=${SCOPED_READS_PER_SECOND};if($ODleft<1)return;$ODleft--;`;

const SAME_STACK =
  'let $ODkey=$ODstack.split("\\n",8).join("\\n"),$ODlast=$ODseen.get($ODkey);' +
  `if($ODlast&&$ODnow-$ODlast.at<${SAME_STACK_QUIET_MS}){$ODlast.skipped++;return}` +
  '$ODdetail={...$ODdetail,skippedSameStack:$ODlast?.skipped??0};$ODseen.set($ODkey,{at:$ODnow,skipped:0});';

const ROW =
  '{t:new Date($ODnow).toISOString(),pid:process.pid,event:$ODevent,sid:globalThis.__odBlankSid??null,' +
  'agentScope:$ODscope?.daemonConnection?($ODscope.sessionId??"unknown"):null,...$ODdetail,...($ODstack?{stack:$ODstack}:{})}';

export const BLANK_LOG_WRITER =
  `(($ODfs,$ODdir)=>{let $ODfile=$ODdir+"/${BLANK_LOG_FILE}",$ODmade=!1,$ODsec=0,$ODleft=0,$ODseen=new Map;` +
  'return($ODevent,$ODdetail,$ODmode)=>{try{let $ODnow=Date.now(),$ODstack;' +
  `if($ODmode===${StackMode.Throttled}){${THROTTLE}}` +
  `if($ODmode){${STACK}}` +
  `if($ODmode===${StackMode.Throttled}){${SAME_STACK}}` +
  'if(!$ODmade)$ODfs.mkdirSync($ODdir,{recursive:!0}),$ODmade=!0;' +
  'let $ODscope=globalThis.__odBlankScope?.();' +
  `$ODfs.appendFileSync($ODfile,JSON.stringify(${ROW})+"\\n")}catch{}}})` +
  `(require("fs"),require("os").homedir()+"/${OVRDROID_UNDER_HOME}")`;

export function blankLog(event: string, detail: string, mode: StackMode): string {
  return `(globalThis.__odBlank??=${BLANK_LOG_WRITER})(${JSON.stringify(event)},${detail},${mode})`;
}

function recent(holder: string): string {
  return `${holder}&&Date.now()-${holder}.at<${CAUSE_WINDOW_MS}?${holder}.reason:`;
}

export const CLEAR_CAUSE = `(${recent('globalThis.__odBlankEpoch')}${recent('globalThis.__odBlankWhy')}"unattributed")`;

const EMPTY_RENDER_DETAIL =
  '{count:0,previous:HF.current,managerFound:!!$ODs,' +
  'effort:$ODs?.getStore().getReasoningEffort()??$ODm.getPendingStore().getReasoningEffort()??$ODm.getDefaultSettingsStore().getReasoningEffort()??null,' +
  'working:$ODs?.getDroidWorkingState()??"idle"}';

const ROOT_MESSAGES = 'W8=x8(o3),HF=O(W8.length);HF.current=W8.length;';

const STOCK_CLEARS =
  'function EB({clearTerminalSequence:e,writeToStdout:t,invalidateOutput:n,resetStaticOutput:r=!1}){n?.(r),t(e)}' +
  'function D5e({clearTerminalSequence:e,writeToStdout:t,invalidateOutput:n,resetStaticHeader:r,bumpStaticKey:a}){n?.(!0),t(e),r?.(),a()}';

const AGENT_START =
  'l("[Compaction] Start (agent)",{type:"compaction",state:"start",reason:C,source:"agent"}),K9().trigger({sessionId:R.sessionId,';

const MANUAL_START =
  'l("[Compaction] Start (manual)",{type:"compaction",state:"start",reason:"manual",source:"jsonrpc",modelId:r,isByok:c});let p=null;try{let t=await tPe({messages:d,sessionId:u,';

const MANUAL_FAILED =
  'catch(t){let y=g?.aborted===!0;throw l(y?"[Compaction] End (manual aborted)"';

const MANUAL_EMPTY = 'return l("[Compaction] End (manual no summary)"';

const MANUAL_DONE = '{let n=performance.now()-p;l("[Compaction] End (manual succeeded)"';

function manualEnd(outcome: string): string {
  return blankLog(
    'compaction',
    `{phase:"end",path:"manual",outcome:${JSON.stringify(outcome)}}`,
    StackMode.None,
  );
}

function drop(via: string, target: string): string {
  return blankLog(
    'session-drop',
    `{via:${JSON.stringify(via)},target:${target}}`,
    StackMode.Always,
  );
}

export const blankDiagPatches: readonly Patch[] = [
  {
    name: 'blank-diag-scoped-read',
    find: 'function v(){aYe(It);let e=Ge();if(e?.awaitsDaemonConnection)throw new i("Async-task daemon connection is not bound yet");if(e?.daemonConnection){let t=be(qe);if(t)return t}',
    replace:
      'globalThis.__odBlankScope=()=>Ge();function v(){aYe(It);let e=Ge();if(e?.awaitsDaemonConnection)throw new i("Async-task daemon connection is not bound yet");if(e?.daemonConnection){let t=be(qe);if(t){' +
      'let $ODsid=globalThis.__odBlankSid;' +
      `if($ODsid&&!t.getSessionStateManager().getSessionManager($ODsid))${blankLog('scoped-read', '{}', StackMode.Throttled)};` +
      'return t}}',
  },
  {
    name: 'blank-diag-empty-render',
    find: ROOT_MESSAGES,
    lookups: ['function x8(g){let M=D().getSessionStateManager(),'],
    replace:
      'W8=x8(o3),HF=O(W8.length);globalThis.__odBlankSid=o3;' +
      'if(!W8.length&&HF.current>0&&HF.$ODsid===o3){let $ODm=D().getSessionStateManager(),$ODs=o3?$ODm.getSessionManager(o3):null;' +
      `${blankLog('empty-render', EMPTY_RENDER_DETAIL, StackMode.Always)}}` +
      'HF.$ODsid=o3;HF.current=W8.length;',
  },
  {
    name: 'blank-diag-epoch-reset',
    find: '"queued-askuser-resolved":void 0;if(J){let n1=g.epoch+1,',
    replace:
      '"queued-askuser-resolved":void 0;if(J){globalThis.__odBlankEpoch={reason:J,at:Date.now()};' +
      `${blankLog('epoch-reset', '{reason:J,epoch:g.epoch+1}', StackMode.None)};let n1=g.epoch+1,`,
  },
  {
    name: 'blank-diag-terminal-clear',
    find: STOCK_CLEARS,
    replace:
      'function EB({clearTerminalSequence:e,writeToStdout:t,invalidateOutput:n,resetStaticOutput:r=!1}){' +
      `${blankLog('static-reset', `{kind:r?"clear-reset":"clear",cause:${CLEAR_CAUSE}}`, StackMode.Always)},n?.(r),t(e)}` +
      'function D5e({clearTerminalSequence:e,writeToStdout:t,invalidateOutput:n,resetStaticHeader:r,bumpStaticKey:a}){' +
      `${blankLog('static-reset', `{kind:"rebuild",cause:${CLEAR_CAUSE}}`, StackMode.Always)},n?.(!0),t(e),r?.(),a()}`,
  },
  {
    name: 'blank-diag-resize-cause',
    find: 'e1=!1,j$(X.current,$$(X.current),i1)',
    replace:
      'e1=!1,globalThis.__odBlankWhy={reason:"resize:"+$$(X.current)+(i1?"":" (height only)"),at:Date.now()},' +
      'j$(X.current,$$(X.current),i1)',
  },
  {
    name: 'blank-diag-remove-session',
    find: 'removeSession(t){jt.validateSessionId(t),this.evictCachedSession(t),',
    replace: `removeSession(t){${drop('removeSession', 't')};jt.validateSessionId(t),this.evictCachedSession(t),`,
  },
  {
    name: 'blank-diag-evict-session',
    find: 'evictCachedSession(t){let o=this.sessions.get(t);if(o)o.getStore().clearAll();',
    replace: `evictCachedSession(t){let o=this.sessions.get(t);${drop('evictCachedSession', 't')};if(o)o.getStore().clearAll();`,
  },
  {
    name: 'blank-diag-session-closed',
    find: 'case"session_closed":{this.cancelLoadPromptEvidence(o),',
    replace: `case"session_closed":{${drop('session_closed', 'o')};this.cancelLoadPromptEvidence(o),`,
  },
  {
    name: 'blank-diag-reopen-on-screen',
    find: 'reopenIfOnScreen(e,t){if(f().getCurrentSessionId()===e&&',
    replace: `reopenIfOnScreen(e,t){${drop('reopenIfOnScreen', 'e')};if(f().getCurrentSessionId()===e&&`,
  },
  {
    name: 'blank-diag-compaction-agent-start',
    find: AGENT_START,
    replace: AGENT_START.replace(
      ',K9()',
      `,${blankLog('compaction', '{phase:"start",path:"agent",reason:C,target:R.sessionId}', StackMode.None)},K9()`,
    ),
  },
  {
    name: 'blank-diag-compaction-agent-end',
    find: 'finally{if(this.compactionAbortRef=null,F.clearCompactionReason(),Ne)',
    replace: `finally{${blankLog('compaction', '{phase:"end",path:"agent",outcome:Ne?"succeeded":"failed"}', StackMode.None)};if(this.compactionAbortRef=null,F.clearCompactionReason(),Ne)`,
  },
  {
    name: 'blank-diag-compaction-manual-start',
    find: MANUAL_START,
    replace: MANUAL_START.replace(
      'isByok:c});',
      `isByok:c});${blankLog('compaction', '{phase:"start",path:"manual",target:u}', StackMode.None)};`,
    ),
  },
  {
    name: 'blank-diag-compaction-manual-failed',
    find: MANUAL_FAILED,
    replace: MANUAL_FAILED.replace('catch(t){', `catch(t){${manualEnd('failed')};`),
  },
  {
    name: 'blank-diag-compaction-manual-empty',
    find: MANUAL_EMPTY,
    replace: MANUAL_EMPTY.replace('return l(', `return ${manualEnd('no summary')},l(`),
  },
  {
    name: 'blank-diag-compaction-manual-done',
    find: MANUAL_DONE,
    replace: MANUAL_DONE.replace(';l(', `;${manualEnd('succeeded')},l(`),
  },
];
