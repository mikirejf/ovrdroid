import type { Patch } from './patches.ts';

export const MODEL_OF_GLOBAL = '__odModelOf';

export const STOCK_ROSTER_HEAD =
  'class pZ{sessionId;ssm=N().getSessionStateManager();listeners=new Set;';

export const MODEL_AND_DESCENDANTS =
  'var $ODsavedModels=new Map;' +
  `globalThis.${MODEL_OF_GLOBAL}=function($ODssm,$ODid){` +
  'let $ODstore=$ODssm.getSessionManager($ODid)?.getStore(),$ODmodel=$ODstore?.getModelId();' +
  'if($ODmodel)return{model:$ODmodel,reasoningEffort:$ODstore.getReasoningEffort()};' +
  'let $ODsaved=$ODsavedModels.get($ODid);if($ODsaved)return $ODsaved;' +
  'try{let $ODpath=p().findSessionSettingsPath($ODid,!0),' +
  '$ODfile=$ODpath?JSON.parse(require("fs").readFileSync($ODpath,"utf8")):void 0;' +
  'if($ODfile?.model){$ODsaved={model:$ODfile.model,reasoningEffort:$ODfile.reasoningEffort};' +
  '$ODsavedModels.set($ODid,$ODsaved);return $ODsaved}}catch{}return{}};' +
  'function $ODrosterOf($ODssm,$ODroot){let $ODseen=new Set([$ODroot]),$ODout=[];' +
  'let $ODwalk=($ODparent)=>{for(let $ODentry of qme($ODssm,$ODparent)){' +
  'if($ODseen.has($ODentry.sessionId))continue;$ODseen.add($ODentry.sessionId);' +
  `$ODout.push({...$ODentry,parentSessionId:$ODparent,...globalThis.${MODEL_OF_GLOBAL}($ODssm,$ODentry.sessionId)});` +
  '$ODwalk($ODentry.sessionId)}};$ODwalk($ODroot);return $ODout}';

export const STOCK_ROSTER_READ = 'y=f?qme(this.ssm,f):[],S=new Map,x=new Map(this.previews)';

export const PATCHED_ROSTER_READ =
  'y=f?$ODrosterOf(this.ssm,f):[],S=new Map,x=new Map(this.previews)';

export const STOCK_ROSTER_WATCHED =
  'let w=f&&y.length>0?GCe(f,y,S,x,this.refresh):null;this.watched=new Set(w?[w.roster.lead.droid.sessionId,...w.roster.sections.flatMap(({nodes:A})=>A.map(({droid:L})=>L.sessionId))]:[])';

export const PATCHED_ROSTER_WATCHED =
  'let w=f&&y.length>0?GCe(f,y,S,x,this.refresh):null;this.watched=new Set(w?[f,...y.map(({sessionId:A})=>A)]:[])';

export const STOCK_ROSTER_EVENTS =
  '"message_thread_updated","subagent_invocation_summary_updated"],zCe=new Set(';

export const PATCHED_ROSTER_EVENTS =
  '"message_thread_updated","subagent_invocation_summary_updated","settings_updated"],zCe=new Set(';

export const STOCK_ROSTER_ROW_TAIL =
  'mission:{kind:"agent",missionId:t.sessionId}},c.get(g.sessionId));return mn(E,D,y?pt(y):qe(g)!==null)})}';

export const PATCHED_ROSTER_ROW_TAIL =
  'mission:{kind:"agent",missionId:t.sessionId},model:g.model,reasoningEffort:g.reasoningEffort,' +
  'nestedRoster:g.parentSessionId!==void 0},c.get(g.sessionId));' +
  'return{...mn(E,D,y?pt(y):qe(g)!==null),parentSessionId:g.parentSessionId===t.sessionId?null:g.parentSessionId??null}})}';

export const STOCK_EXPAND_CHECK = 'function d9(f,y,S,x,w){let I=y1(y)&&w.has(y.droid.sessionId);';

export const PATCHED_EXPAND_CHECK =
  'function d9(f,y,S,x,w){let I=y1(y)&&(w.has(y.droid.sessionId)||' +
  'y.droid.nestedRoster===!0&&y.children.length>0&&!w.has("collapsed:"+y.droid.sessionId));';

export const STOCK_EXPAND_TOGGLE =
  'function ufe(f,y,S){let x=y2(f.expandedDroids,y,S);return x===f.expandedDroids?f:{...f,expandedDroids:x}}';

export const PATCHED_EXPAND_TOGGLE =
  'function ufe(f,y,S){let x=y2(y2(f.expandedDroids,y,S),"collapsed:"+y,!S);' +
  'return x===f.expandedDroids?f:{...f,expandedDroids:x}}';

export const sessionRosterPatches: readonly Patch[] = [
  {
    name: 'session-roster-model-lookup',
    find: STOCK_ROSTER_HEAD,
    lookups: ['function u7(f){let y=p().getCurrentSessionId()??void 0,', '?qme(this.ssm,f):[]'],
    replace: `${MODEL_AND_DESCENDANTS}${STOCK_ROSTER_HEAD}`,
  },
  {
    name: 'session-roster-lists-descendants',
    find: STOCK_ROSTER_READ,
    replace: PATCHED_ROSTER_READ,
  },
  {
    name: 'session-roster-watches-descendants',
    find: STOCK_ROSTER_WATCHED,
    replace: PATCHED_ROSTER_WATCHED,
  },
  {
    name: 'session-roster-republishes-on-settings',
    find: STOCK_ROSTER_EVENTS,
    replace: PATCHED_ROSTER_EVENTS,
  },
  {
    name: 'session-roster-row-carries-model-and-parent',
    find: STOCK_ROSTER_ROW_TAIL,
    replace: PATCHED_ROSTER_ROW_TAIL,
  },
  {
    name: 'session-roster-expands-nested-by-default',
    find: STOCK_EXPAND_CHECK,
    replace: PATCHED_EXPAND_CHECK,
  },
  {
    name: 'session-roster-remembers-a-collapse',
    find: STOCK_EXPAND_TOGGLE,
    replace: PATCHED_EXPAND_TOGGLE,
  },
];
