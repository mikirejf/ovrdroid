import type { Patch } from './patches.ts';

export const REWIND_MOVE_GLOBAL = '__odRewindMoveTasks';

export const SUBAGENT_TAG = 'subagent';

const STORE_ANCHOR =
  'function e8(t){return h().invocations.filter((e)=>e.parentSessionId===t).map(v)}';

const STORE_LOOKUPS = [
  'async function k(t,e){let{storePath:o,backupPath:s}=x()',
  'function S(t){return t==="pending"||t==="running"}',
];

export const MOVE_TASKS =
  `globalThis.${REWIND_MOVE_GLOBAL}=async($ODfrom,$ODto,$ODkept,$ODpath)=>{let $ODmoved=[];` +
  'await k(($ODs)=>{$ODmoved=[];for(let $ODe of $ODs.invocations)' +
  'if($ODe.parentSessionId===$ODfrom&&$ODe.runInBackground&&S($ODe.status)&&$ODkept.has($ODe.parentToolUseId))' +
  '$ODe.parentSessionId=$ODto,$ODe.parentTranscriptPath=$ODpath,$ODe.updatedAt=Date.now(),$ODmoved.push(v($ODe));' +
  'return $ODmoved.length>0});return $ODmoved};';

const FORK =
  'let S=await c.forkSession(l,{kind:"beforeMessage",messageId:t},a,l,"rewind",' +
  '{preserveCurrentSession:!0,keepPromptCacheKey:!0,extraTags:[{name:m6,metadata:{[Aye]:l}}]});';

const FORK_LOOKUPS = [
  'hT().recoverParentBackgroundChildren(t,Cq,{reconcileStale:N().reachesHostingDaemon()})',
  'await N().close(),this.ideInitPromise',
  'h(d,"[JsonRpc] Failed to execute rewind")',
];

export const KEPT_TOOL_CALLS =
  'function $ODkeptToolCalls($ODtext){let $ODkept=new Set;for(let $ODline of $ODtext.split("\\n")){' +
  'if(!$ODline.includes(\'"tool_use"\'))continue;let $ODmsg;try{$ODmsg=JSON.parse($ODline).message}catch{continue}' +
  'for(let $ODb of Array.isArray($ODmsg?.content)?$ODmsg.content:[])if($ODb?.type==="tool_use"&&$ODb.id)$ODkept.add($ODb.id)}' +
  'return $ODkept}';

export const RETAG =
  'function $ODretag($ODtags,$ODfrom,$ODto){let $ODchanged=!1,$ODnext=$ODtags.map(($ODg)=>{' +
  `if($ODg?.name!=="${SUBAGENT_TAG}"||$ODg.metadata?.callingSessionId!==$ODfrom)return $ODg;` +
  '$ODchanged=!0;return{...$ODg,metadata:{...$ODg.metadata,callingSessionId:$ODto}}});return $ODchanged?$ODnext:void 0}';

export const HAND_OVER =
  `${KEPT_TOOL_CALLS}${RETAG}` +
  'async function $ODhandOver($ODfrom,$ODto){let $ODfs=require("fs"),$ODpath=c.getSessionTranscriptPath($ODto);if(!$ODpath)return;' +
  `let $ODmoved=await globalThis.${REWIND_MOVE_GLOBAL}($ODfrom,$ODto,$ODkeptToolCalls($ODfs.readFileSync($ODpath,"utf8")),$ODpath),` +
  '$ODclient=N();for(let $ODi of $ODmoved){let $ODchild=$ODi.childSessionId;' +
  'hT().trackBackgroundChild({parentSessionId:$ODto,childSessionId:$ODchild,parentToolUseId:$ODi.parentToolUseId,taskInvocationId:$ODi.taskInvocationId,deliveryEligible:!0});' +
  '$ODclient.getSessionStateManager().getSessionManager($ODchild)?.getStore().setCallingSessionId($ODto);' +
  'let $ODcp=c.getSessionTranscriptPath($ODchild)?.replace(/\\.jsonl$/,".settings.json"),' +
  '$ODtags=$ODcp&&$ODfs.existsSync($ODcp)?$ODretag(JSON.parse($ODfs.readFileSync($ODcp,"utf8")).tags??[],$ODfrom,$ODto):void 0;' +
  'if($ODtags)await $ODclient.updateSessionSettings({sessionId:$ODchild,tags:$ODtags})}}' +
  'try{await $ODhandOver(l,S)}catch($ODerr){h($ODerr,"[ovrdroid] Failed to hand running tasks to the rewound session")}';

const TASK_OUTPUT_FIND =
  'w=yB(f,S)??T(),b=w?void 0:Rn(S),v=b?.machineId;' +
  'if(b&&v&&b.parentSessionId===t.sessionId&&Si(b.status)){';

export const ATTACH_MOVED_TASK =
  'if(!w&&b&&!v&&b.runInBackground&&b.parentSessionId===t.sessionId&&Si(b.status)){' +
  'await(await p.adapter.ensureConnectedAndGetController()).loadSession({sessionId:S}).catch(()=>{});' +
  'w=yB(f,S);if(w)b=void 0}';

export const rewindPatches: readonly Patch[] = [
  {
    name: 'rewind-task-store-moves-running-tasks',
    find: STORE_ANCHOR,
    lookups: STORE_LOOKUPS,
    replace: `${STORE_ANCHOR}${MOVE_TASKS}`,
  },
  {
    name: 'rewind-hands-running-tasks-to-new-session',
    find: FORK,
    lookups: FORK_LOOKUPS,
    replace: `${FORK}${HAND_OVER}`,
  },
  {
    name: 'task-output-attaches-moved-running-task',
    find: TASK_OUTPUT_FIND,
    lookups: ['p=new Do,f=p.getSessionStateManager(),g=await N3(t.sessionId),S=E3(f,a,g)'],
    replace: TASK_OUTPUT_FIND.replace('if(b&&v', `${ATTACH_MOVED_TASK}if(b&&v`),
  },
];
