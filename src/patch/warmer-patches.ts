import { CACHE_CLOCK_RECORDERS, CACHE_TRUSTED_MS } from './cache-clock.ts';
import type { Patch } from './patches.ts';
import { USAGE_LOG_OPEN } from './usage-patches.ts';

const MINUTE_MS = 60_000;
const ANTHROPIC_WARM_DELAY_MS = CACHE_TRUSTED_MS;
const OTHER_WARM_DELAY_MS = 27 * MINUTE_MS;
const OPENAI_MIN_OUTPUT_TOKENS = 16;

export const MIN_WARM_DELAY_MS = MINUTE_MS;
export const MAX_WARM_DELAY_MS = 60 * MINUTE_MS;

export const WARM_DELAY_ENV = 'OVRDROID_WARM_DELAY_MS';
export const WARM_MESSAGE_ID_PREFIX = 'ovrdroid-cache-warm-';
export const STREAMING_CORE_IMPORT = 'await import("/$bunfs/root/chunk-v45yswh1.js")';

const SEND =
  'async function $ODWs($ODcore,$ODsnap,$ODsig){' +
  'let $ODstop=()=>$ODcore.abortStreaming();if($ODsig.aborted)$ODstop();$ODsig.addEventListener("abort",$ODstop,{once:!0});' +
  'try{return await $ODcore.sendMessage({sessionId:$ODsnap.sessionId,modelId:$ODsnap.modelId,isSpecMode:$ODsnap.isSpecMode,' +
  'conversationHistory:$ODsnap.preparedHistory,systemMessage:$ODsnap.systemMessage,reasoningEffort:$ODsnap.effort,persistProviderLock:!1,' +
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

const ARM =
  `function $ODWd($ODsnap){let $ODenv=Number(process.env.${WARM_DELAY_ENV});` +
  `return $ODenv>=${MIN_WARM_DELAY_MS}&&$ODenv<=${MAX_WARM_DELAY_MS}?$ODenv:ee($ODsnap.modelId).modelProvider==="anthropic"?${ANTHROPIC_WARM_DELAY_MS}:${OTHER_WARM_DELAY_MS}}` +
  'function $ODWa($ODsnap){$ODWc($ODsnap.sessionId);let $ODcell={snap:$ODsnap};$ODcell.timer=setTimeout(()=>{$ODWf($ODsnap.sessionId,$ODcell)},$ODWd($ODsnap)),$ODcell.timer.unref?.(),$ODWt.set($ODsnap.sessionId,$ODcell)}';

const CANCEL =
  'function $ODWc($ODsid){let $ODcell=$ODWt.get($ODsid);if(!$ODcell)return;clearTimeout($ODcell.timer),$ODcell.ac?.abort(),$ODWt.delete($ODsid)}';

const FIRE =
  'async function $ODWf($ODsid,$ODcell){if($ODWt.get($ODsid)!==$ODcell)return;let $ODsnap=$ODcell.snap,$ODlast=Qh.get($ODsid),$ODkids=!$ODlast||$ODlast===$ODsnap?$ODWk($ODsid):0;' +
  'if(!$ODkids||p().currentSessionId!==$ODsid){$ODWt.delete($ODsid);return}' +
  'let $ODac=new AbortController,$ODres,$ODsent;$ODcell.ac=$ODac;' +
  `try{let{createLLMStreamingCore:$ODmake}=${STREAMING_CORE_IMPORT},$ODcore=${CLIENT};$ODsent=Date.now();` +
  'try{$ODres=await $ODWs($ODcore,$ODsnap,$ODac.signal)}finally{$ODcore.dispose()}}' +
  'catch($ODerr){if(!$ODac.signal.aborted)n("[ovrdroid] cache warm failed",{sessionId:$ODsid,modelId:$ODsnap.modelId,cause:$ODerr})}' +
  'if($ODres&&!$ODres.wasAborted)$ODCw($ODsid,$ODsent);' +
  `try{${USAGE_LOG_OPEN}__odUsage({t:Date.now(),s:$ODsid,m:$ODsnap.modelId,warm:!0,kids:$ODkids,ok:!!$ODres&&!$ODres.wasAborted,` +
  'in:$ODres?.usage?.inputTokens,cr:$ODres?.usage?.cacheReadInputTokens,cw:$ODres?.usage?.cacheCreationInputTokens,out:$ODres?.usage?.outputTokens})}catch{}' +
  'if($ODWt.get($ODsid)===$ODcell&&!$ODac.signal.aborted)$ODWa($ODsnap)}';

export const warmerPatches: readonly Patch[] = [
  {
    name: 'cache-warm-arm',
    find: 'function pY(t){z5(t.capturedAt),Qh.set(t.sessionId,t)}',
    lookups: [
      'function ee(t){return sw(t,{getCustomModels:()=>C().getCustomModels()',
      'function p(){let t=Te(IX);if(t)return t;if(!kv)kv=new Oi,',
      'n("[Prompt-Caching] Failed to promote cached prefix",{sessionId:',
      `let{createOneShotSendMessageClient:c}=${STREAMING_CORE_IMPORT}`,
    ],
    replace: `var $ODWt=new Map;${SEND}${WARM_SESSION}${KIDS}${ARM}${CANCEL}${CACHE_CLOCK_RECORDERS}${FIRE}function pY(t){z5(t.capturedAt),Qh.set(t.sessionId,t);try{$ODCs(t),$ODWa(t)}catch{}}`,
  },
  {
    name: 'cache-warm-close',
    find: 'function LV(t){vu(t),Zh.delete(t)}',
    replace: 'function LV(t){$ODWc(t),vu(t),Zh.delete(t)}',
  },
  {
    name: 'cache-warm-forget',
    find: 'function mY(t){Qh.delete(t)}var V5=',
    replace: 'function mY(t){$ODWc(t),Qh.delete(t)}var V5=',
  },
  {
    name: 'cache-warm-max-tokens',
    find: 'maxOutputTokens:fe.maxOutputTokens}:void 0,conversationHistory:ae,baseParams:Hs',
    lookups: [
      'hasProviderRotation:!1})},on=async({conversationHistory:ae,systemMessage:ye,callbacks:pe,sessionId:Se,assistantMessageId:De,recordProviderAttempt:Ge,recordUpstreamRequestId:dt,allowContextLimitS3Logging:mt,maxTokensOverride:Mt,',
    ],
    replace:
      'maxOutputTokens:Mt===void 0?fe.maxOutputTokens:void 0}:void 0,conversationHistory:ae,baseParams:Hs',
  },
  {
    name: 'cache-warm-effort',
    find: 'vu(b),pY({sessionId:b,modelId:rt,isSpecMode:ho,',
    lookups: ['rt=O,Ci=K,ho=_,On=m.getDisplayActiveModel(),$o=tt(On)?On:void 0,Yt=B,'],
    replace: 'vu(b),pY({effort:Yt,sessionId:b,modelId:rt,isSpecMode:ho,',
  },
  {
    name: 'cache-warm-child-count',
    find: 'function xz({sessionStateManager:e,taskId:t,afterMessageId:o}){',
    lookups: [
      'o.status==="running")}function vz(e,t){let o=new Set,i=0;',
      'async queueParentMessage(e){return await Ht({client:L(),',
    ],
    replace:
      'globalThis.__odKids=($ODsid)=>vz(L().getSessionStateManager(),$ODsid);' +
      'function xz({sessionStateManager:e,taskId:t,afterMessageId:o}){',
  },
];
