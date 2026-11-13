import { CACHE_CLOCK_RECORDERS, CACHE_TRUSTED_MS } from './cache-clock.ts';
import {
  KEEP_WARM_OFF,
  KEEP_WARM_ON,
  KEEP_WARM_ON_PENDING,
  KEEP_WARM_USAGE,
  keepWarmPatches,
} from './keep-warm-patches.ts';
import type { Patch } from './patches.ts';
import { USAGE_LOG_OPEN } from './usage-patches.ts';

const MINUTE_MS = 60_000;
const ANTHROPIC_WARM_DELAY_MS = CACHE_TRUSTED_MS;
const OTHER_WARM_DELAY_MS = 27 * MINUTE_MS;
const OPENAI_MIN_OUTPUT_TOKENS = 16;

export const MIN_WARM_DELAY_MS = MINUTE_MS;
export const MAX_WARM_DELAY_MS = 60 * MINUTE_MS;

export const KEEP_WARM_SET_KEY = '__odWarmOn';
export const KEEP_WARM_SET_GLOBAL = `globalThis.${KEEP_WARM_SET_KEY}`;
export const KEEP_WARM_ARMED_KEY = '__odWarmArmed';
export const KEEP_WARM_ARMED_GLOBAL = `globalThis.${KEEP_WARM_ARMED_KEY}`;
export const WARM_DELAY_ENV = 'OVRDROID_WARM_DELAY_MS';
export const WARM_MESSAGE_ID_PREFIX = 'ovrdroid-cache-warm-';
export const STREAMING_CORE_IMPORT = 'await import("/$bunfs/root/chunk-v45yswh1.js")';

const SEND =
  'async function $ODWs($ODcore,$ODsnap,$ODsig){' +
  'let $ODstop=()=>$ODcore.abortStreaming();if($ODsig.aborted)$ODstop();$ODsig.addEventListener("abort",$ODstop,{once:!0});' +
  'try{return await $ODcore.sendMessage({sessionId:$ODsnap.sessionId,modelId:$ODsnap.modelId,isSpecMode:$ODsnap.isSpecMode,' +
  'conversationHistory:$ODsnap.preparedHistory,systemMessage:$ODsnap.systemMessage,reasoningEffort:$ODsnap.reasoningEffort,persistProviderLock:!1,' +
  `maxTokensOverride:ee($ODsnap.modelId).modelProvider==="anthropic"?1:${OPENAI_MIN_OUTPUT_TOKENS},` +
  `expectsText:!1,expectsProgress:!1,assistantMessageId:"${WARM_MESSAGE_ID_PREFIX}"+Date.now(),` +
  'callbacks:{onRequestStream:()=>{},onStreamingComplete:()=>{},onStreamingError:()=>{}}})}' +
  'finally{$ODsig.removeEventListener("abort",$ODstop)}}';

const WARM_SESSION_WRITES = [
  'commitTurnTokenUsage',
  'addTokenUsage',
  'recordTimeToFirstToken',
] as const;

const WARM_SESSION =
  `var $ODWw=new Set(${JSON.stringify(WARM_SESSION_WRITES)});` +
  'function $ODWm($ODsess,$ODsid){return new Proxy($ODsess,{get($ODtgt,$ODkey){let $ODval=Reflect.get($ODtgt,$ODkey,$ODtgt);' +
  'if(typeof $ODval!=="function")return $ODval;if(!$ODWw.has($ODkey))return $ODval.bind($ODtgt);' +
  'return(...$ODargs)=>{if($ODtgt.currentSessionId!==$ODsid)return;' +
  'return $ODkey==="commitTurnTokenUsage"?$ODval.call($ODtgt,{...$ODargs[0],odWarm:!0},$ODargs[1]):$ODval.apply($ODtgt,$ODargs)}}})}';

const CLIENT =
  '$ODmake({llmClientsRef:{current:{anthropic:null,openai:null,bedrock:null,bedrockConverse:null,bedrockOpenAI:null,openaiResponsesWs:null}},abortControllerRef:{current:null},ideToolsRef:{current:null},' +
  'getSystemPromptOverride:()=>{},getOutputStylePrompt:()=>{},isS3LoggingEnabled:()=>!1,' +
  'session:$ODWm(p(),$ODsid),settings:C(),ide:{getIdeClient:()=>{}},getRetryStrategy:()=>"no_retry"},' +
  '{emitLlmRetryStatus:!1,platformOverrides:{useOpenAIResponsesWebSocket:()=>!1}})';

const KIDS = 'function $ODWk($ODsid){try{return globalThis.__odKids?.($ODsid)??0}catch{return 0}}';

const SNAPSHOT_STORE = 'Qh.set(t.sessionId,{snapshot:t,capturedBy:new WeakRef(Dt())})';
const CHILD_TRACKER =
  'function ST(){let e=Se(vi);if(e)return e;return zt??=new ze,zt}class he{detachedController=';

const ARM =
  `function $ODWd($ODsnap){let $ODenv=Number(process.env.${WARM_DELAY_ENV});` +
  `return $ODenv>=${MIN_WARM_DELAY_MS}&&$ODenv<=${MAX_WARM_DELAY_MS}?$ODenv:ee($ODsnap.modelId).modelProvider==="anthropic"?${ANTHROPIC_WARM_DELAY_MS}:${OTHER_WARM_DELAY_MS}}` +
  'function $ODWa($ODsnap,$ODat,$ODin){let $ODarmed=$ODWt.has($ODsnap.sessionId);$ODWc($ODsnap.sessionId,!0),$ODWr.set($ODsnap.sessionId,{snap:$ODsnap,at:$ODat});' +
  'let $ODcell={snap:$ODsnap,at:$ODat};$ODcell.timer=setTimeout(()=>{$ODWf($ODsnap.sessionId,$ODcell)},$ODin??$ODWd($ODsnap)),$ODcell.timer.unref?.(),$ODWt.set($ODsnap.sessionId,$ODcell);if(!$ODarmed)$ODCr.changed()}';

const KEEP =
  'function $ODWy($ODarg){let $ODsid=p().currentSessionId,$ODword=$ODarg?.toLowerCase(),' +
  '$ODto=$ODarg===void 0?!$ODWon.has($ODsid):$ODword==="on"?!0:$ODword==="off"?!1:null;' +
  `if($ODto===null)return ${JSON.stringify(KEEP_WARM_USAGE)};` +
  `if(!$ODto)return $ODWon.delete($ODsid),$ODCr.changed(),${JSON.stringify(KEEP_WARM_OFF)};` +
  '$ODWon.add($ODsid),$ODCr.changed();let $ODmem=$ODWr.get($ODsid);' +
  'if($ODmem&&!$ODWt.has($ODsid))$ODWa($ODmem.snap,$ODmem.at,Math.max(0,$ODmem.at+$ODWd($ODmem.snap)-Date.now()));' +
  `return $ODmem?${JSON.stringify(KEEP_WARM_ON)}:${JSON.stringify(KEEP_WARM_ON_PENDING)}}globalThis.__odKeepWarm=$ODWy;`;

const CANCEL =
  'function $ODWc($ODsid,$ODrearm){let $ODcell=$ODWt.get($ODsid);if(!$ODcell)return;clearTimeout($ODcell.timer),$ODcell.ac?.abort(),$ODWt.delete($ODsid);if(!$ODrearm)$ODCr.changed()}';

const FIRE =
  'async function $ODWf($ODsid,$ODcell){if($ODWt.get($ODsid)!==$ODcell)return;let $ODsnap=$ODcell.snap,$ODlast=Qh.get($ODsid)?.snapshot,$ODfresh=!$ODlast||$ODlast===$ODsnap,$ODkids=$ODfresh?$ODWk($ODsid):0;' +
  'if(!($ODkids||$ODfresh&&$ODWon.has($ODsid))||p().currentSessionId!==$ODsid){$ODWt.delete($ODsid),$ODCr.changed();return}' +
  'let $ODac=new AbortController,$ODres,$ODsent;$ODcell.ac=$ODac;' +
  `try{let{createLLMStreamingCore:$ODmake}=${STREAMING_CORE_IMPORT},$ODcore=${CLIENT};$ODsent=Date.now();` +
  'try{$ODres=await $ODWs($ODcore,$ODsnap,$ODac.signal)}finally{$ODcore.dispose()}}' +
  'catch($ODerr){if(!$ODac.signal.aborted)n("[ovrdroid] cache warm failed",{sessionId:$ODsid,modelId:$ODsnap.modelId,cause:$ODerr})}' +
  'if($ODres&&!$ODres.wasAborted)$ODCw($ODsid,$ODsent);' +
  `try{${USAGE_LOG_OPEN}__odUsage({t:Date.now(),s:$ODsid,m:$ODsnap.modelId,warm:!0,kids:$ODkids,ok:!!$ODres&&!$ODres.wasAborted,` +
  'in:$ODres?.usage?.inputTokens,cr:$ODres?.usage?.cacheReadInputTokens,cw:$ODres?.usage?.cacheCreationInputTokens,out:$ODres?.usage?.outputTokens})}catch{}' +
  `if($ODWt.get($ODsid)===$ODcell&&!$ODac.signal.aborted)$ODres&&!$ODres.wasAborted?$ODWa($ODsnap,$ODsent):$ODWa($ODsnap,$ODcell.at,${MIN_WARM_DELAY_MS})}`;

export const warmerPatches: readonly Patch[] = [
  {
    name: 'cache-warm-arm',
    find: `function pY(t){z5(t.capturedAt),${SNAPSHOT_STORE}}`,
    lookups: [
      'let o=ee(t.modelId);return o.modelProvider==="anthropic"&&!o.isUnknownFallback}',
      'let t=C(),s=t.getCustomModels();',
      'function p(){let t=Te(IX);if(t)return t;if(!kv)kv=new Oi,',
      'n("[Prompt-Caching] Failed to refresh cached prefix",{sessionId:',
      `let{createOneShotSendMessageClient:c}=${STREAMING_CORE_IMPORT}`,
      'return vo(()=>Xq(e))}catch(e){return Promise.reject(e)}}takePendingMissionMetadataSync(){',
    ],
    replace: `var $ODWt=${KEEP_WARM_ARMED_GLOBAL}=new Map,$ODWon=${KEEP_WARM_SET_GLOBAL}=new Set,$ODWr=new Map;${SEND}${WARM_SESSION}${KIDS}${ARM}${CANCEL}${KEEP}${CACHE_CLOCK_RECORDERS}${FIRE}function pY(t){z5(t.capturedAt),${SNAPSHOT_STORE};try{$ODCs(t),$ODWa(t,t.capturedAt)}catch{}}`,
  },
  {
    name: 'cache-warm-close',
    find: 'function mY(t){Qh.delete(t)}function nY(t,o){',
    replace:
      'function mY(t){$ODWc(t),$ODWon.delete(t),$ODWr.delete(t),Qh.delete(t)}function nY(t,o){',
  },
  {
    name: 'cache-warm-forget',
    find: 'function nY(t,o){if(Qh.get(t)?.capturedBy.deref()===o)Qh.delete(t)}',
    replace:
      'function nY(t,o){if(Qh.get(t)?.capturedBy.deref()===o)$ODWc(t),$ODWr.delete(t),Qh.delete(t)}',
  },
  {
    name: 'cache-warm-child-count',
    find: CHILD_TRACKER,
    replace: `globalThis.__odKids=($ODsid)=>+ST().hasRunningChildren($ODsid);${CHILD_TRACKER}`,
  },
  ...keepWarmPatches,
];
