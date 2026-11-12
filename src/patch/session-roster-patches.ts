import type { Patch } from './patches.ts';

export const MODEL_OF_GLOBAL = '__odModelOf';

export const STOCK_ROSTER_HEAD =
  'class VQ{sessionId;ssm=N().getSessionStateManager();changes=Ts("SessionRosterStore",';

export const MODEL_LOOKUP =
  'var $ODsavedModels=new Map;' +
  `globalThis.${MODEL_OF_GLOBAL}=function($ODssm,$ODid){` +
  'let $ODstore=$ODssm.getSessionManager($ODid)?.getStore(),$ODmodel=$ODstore?.getModelId();' +
  'if($ODmodel)return{model:$ODmodel,reasoningEffort:$ODstore.getReasoningEffort()};' +
  'let $ODsaved=$ODsavedModels.get($ODid);if($ODsaved)return $ODsaved;' +
  'try{let $ODpath=m().findSessionSettingsPath($ODid,!0),' +
  '$ODfile=$ODpath?JSON.parse(require("fs").readFileSync($ODpath,"utf8")):void 0;' +
  'if($ODfile?.model){$ODsaved={model:$ODfile.model,reasoningEffort:$ODfile.reasoningEffort};' +
  '$ODsavedModels.set($ODid,$ODsaved);return $ODsaved}}catch{}return{}};';

export const STOCK_ROSTER_READ =
  'function Wke(f,y,x,v){let I=y&&_Ce(f,y);if(!I)return GP;let A=pCe(f,I);';

export const PATCHED_ROSTER_READ =
  'function Wke(f,y,x,v){let I=y&&_Ce(f,y);if(!I)return GP;let A=pCe(f,I).map(($ODentry)=>' +
  `({...$ODentry,...globalThis.${MODEL_OF_GLOBAL}(f,$ODentry.sessionId)}));`;

export const STOCK_ROSTER_EVENTS =
  '"message_thread_updated","subagent_invocation_summary_updated"],zCe=new Set(';

export const PATCHED_ROSTER_EVENTS =
  '"message_thread_updated","subagent_invocation_summary_updated","settings_updated"],zCe=new Set(';

export const STOCK_ROSTER_ROW_TAIL =
  'mission:{kind:"agent",missionId:t.sessionId},...f.archived&&{archived:f.archived}},M);' +
  'return{droid:In(b,p,g?Ye(g):y!==null),pullRequestArtifacts:I}})}';

export const PATCHED_ROSTER_ROW_TAIL =
  'mission:{kind:"agent",missionId:t.sessionId},model:f.model,reasoningEffort:f.reasoningEffort,' +
  '...f.archived&&{archived:f.archived}},M);' +
  'return{droid:In(b,p,g?Ye(g):y!==null),pullRequestArtifacts:I}})}';

export const sessionRosterPatches: readonly Patch[] = [
  {
    name: 'session-roster-model-lookup',
    find: STOCK_ROSTER_HEAD,
    lookups: ['m().getSessionsForSelector('],
    replace: `${MODEL_LOOKUP}${STOCK_ROSTER_HEAD}`,
  },
  {
    name: 'session-roster-enriches-direct-children',
    find: STOCK_ROSTER_READ,
    replace: PATCHED_ROSTER_READ,
  },
  {
    name: 'session-roster-republishes-on-settings',
    find: STOCK_ROSTER_EVENTS,
    replace: PATCHED_ROSTER_EVENTS,
  },
  {
    name: 'session-roster-row-carries-model',
    find: STOCK_ROSTER_ROW_TAIL,
    replace: PATCHED_ROSTER_ROW_TAIL,
  },
];
