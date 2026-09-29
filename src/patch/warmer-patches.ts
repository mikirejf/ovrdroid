import { CACHE_CLOCK_RECORDERS } from './cache-clock.ts';
import type { Patch } from './patches.ts';
import { USAGE_LOG_OPEN } from './usage-patches.ts';

const MINUTE_MS = 60_000;
const ANTHROPIC_WARM_DELAY_MS = 45 * MINUTE_MS;
const OTHER_WARM_DELAY_MS = 27 * MINUTE_MS;
const OPENAI_MIN_OUTPUT_TOKENS = 16;

export const MIN_WARM_DELAY_MS = MINUTE_MS;
export const MAX_WARM_DELAY_MS = 60 * MINUTE_MS;

export const WARM_DELAY_ENV = 'OVRDROID_WARM_DELAY_MS';
export const WARM_MESSAGE_ID_PREFIX = 'ovrdroid-cache-warm-';
export const STREAMING_CORE_IMPORT = 'await import("/$bunfs/root/chunk-v45yswh1.js")';

const SEND =
  'async function $ODWs(t,s,r){' +
  'let f=()=>t.abortStreaming();if(r.aborted)f();r.addEventListener("abort",f,{once:!0});' +
  'try{return await t.sendMessage({sessionId:s.sessionId,modelId:s.modelId,isSpecMode:s.isSpecMode,' +
  'conversationHistory:s.preparedHistory,systemMessage:s.systemMessage,reasoningEffort:s.effort,persistProviderLock:!1,' +
  `maxTokensOverride:ee(s.modelId).modelProvider==="anthropic"?1:${OPENAI_MIN_OUTPUT_TOKENS},` +
  `expectsText:!1,expectsProgress:!1,assistantMessageId:"${WARM_MESSAGE_ID_PREFIX}"+Date.now(),` +
  'callbacks:{onRequestStream:()=>{},onStreamingComplete:()=>{},onStreamingError:()=>{}}})}' +
  'finally{r.removeEventListener("abort",f)}}';

const WARM_SESSION_WRITES = [
  'commitTurnTokenUsage',
  'addTokenUsage',
  'recordTimeToFirstToken',
] as const;

const WARM_SESSION =
  `var $ODWw=new Set(${JSON.stringify(WARM_SESSION_WRITES)});` +
  'function $ODWm(s,i){return new Proxy(s,{get(o,k){let v=Reflect.get(o,k,o);' +
  'if(typeof v!=="function")return v;if(!$ODWw.has(k))return v.bind(o);' +
  'return(...a)=>{if(o.currentSessionId!==i)return;' +
  'return k==="commitTurnTokenUsage"?v.call(o,{...a[0],odWarm:!0},a[1]):v.apply(o,a)}}})}';

const CLIENT =
  'l({llmClientsRef:{current:{anthropic:null,openai:null,bedrock:null,bedrockConverse:null,bedrockOpenAI:null,openaiResponsesWs:null}},abortControllerRef:{current:null},ideToolsRef:{current:null},' +
  'getSystemPromptOverride:()=>{},getOutputStylePrompt:()=>{},isS3LoggingEnabled:()=>!1,' +
  'session:$ODWm(p(),t),settings:C(),ide:{getIdeClient:()=>{}},getRetryStrategy:()=>"no_retry"},' +
  '{emitLlmRetryStatus:!1,platformOverrides:{useOpenAIResponsesWebSocket:()=>!1}})';

const KIDS = 'function $ODWk(t){try{return globalThis.__odKids?.(t)??0}catch{return 0}}';

const ARM =
  `function $ODWd(s){let v=Number(process.env.${WARM_DELAY_ENV});` +
  `return v>=${MIN_WARM_DELAY_MS}&&v<=${MAX_WARM_DELAY_MS}?v:ee(s.modelId).modelProvider==="anthropic"?${ANTHROPIC_WARM_DELAY_MS}:${OTHER_WARM_DELAY_MS}}` +
  'function $ODWa(s){$ODWc(s.sessionId);let c={snap:s};c.timer=setTimeout(()=>{$ODWf(s.sessionId,c)},$ODWd(s)),c.timer.unref?.(),$ODWt.set(s.sessionId,c)}';

const CANCEL =
  'function $ODWc(t){let c=$ODWt.get(t);if(!c)return;clearTimeout(c.timer),c.ac?.abort(),$ODWt.delete(t)}';

const FIRE =
  'async function $ODWf(t,c){if($ODWt.get(t)!==c)return;let s=c.snap,q=Qh.get(t),k=!q||q===s?$ODWk(t):0;' +
  'if(!k||p().currentSessionId!==t){$ODWt.delete(t);return}' +
  'let r=new AbortController,o,$w;c.ac=r;' +
  `try{let{createLLMStreamingCore:l}=${STREAMING_CORE_IMPORT},d=${CLIENT};$w=Date.now();` +
  'try{o=await $ODWs(d,s,r.signal)}finally{d.dispose()}}' +
  'catch(e){if(!r.signal.aborted)n("[ovrdroid] cache warm failed",{sessionId:t,modelId:s.modelId,cause:e})}' +
  'if(o&&!o.wasAborted)$ODCw(t,$w);' +
  `try{${USAGE_LOG_OPEN}__odUsage({t:Date.now(),s:t,m:s.modelId,warm:!0,kids:k,ok:!!o&&!o.wasAborted,` +
  'in:o?.usage?.inputTokens,cr:o?.usage?.cacheReadInputTokens,cw:o?.usage?.cacheCreationInputTokens,out:o?.usage?.outputTokens})}catch{}' +
  'if($ODWt.get(t)===c&&!r.signal.aborted)$ODWa(s)}';

export const warmerPatches: readonly Patch[] = [
  {
    name: 'cache-warm-arm',
    find: 'function pY(t){z5(t.capturedAt),Qh.set(t.sessionId,t)}',
    replace: `var $ODWt=new Map;${SEND}${WARM_SESSION}${KIDS}${ARM}${CANCEL}${CACHE_CLOCK_RECORDERS}${FIRE}function pY(t){z5(t.capturedAt),Qh.set(t.sessionId,t);try{$ODCs(t),$ODWa(t)}catch{}}`,
  },
  {
    name: 'cache-warm-close',
    find: 'function LV(t){vu(t),Zh.delete(t)}',
    replace: 'function LV(t){$ODWc(t),vu(t),Zh.delete(t)}',
  },
  {
    name: 'cache-warm-forget',
    find: 'function mY(t){Qh.delete(t)}',
    replace: 'function mY(t){$ODWc(t),Qh.delete(t)}',
  },
  {
    name: 'cache-warm-max-tokens',
    find: 'maxOutputTokens:fe.maxOutputTokens}:void 0,conversationHistory:ae,baseParams:Hs',
    replace:
      'maxOutputTokens:Mt===void 0?fe.maxOutputTokens:void 0}:void 0,conversationHistory:ae,baseParams:Hs',
  },
  {
    name: 'cache-warm-effort',
    find: 'vu(b),pY({sessionId:b,modelId:rt,isSpecMode:ho,',
    replace: 'vu(b),pY({effort:Yt,sessionId:b,modelId:rt,isSpecMode:ho,',
  },
  {
    name: 'cache-warm-child-count',
    find: 'function xz({sessionStateManager:e,taskId:t,afterMessageId:o}){',
    replace:
      'globalThis.__odKids=(s)=>vz(L().getSessionStateManager(),s);' +
      'function xz({sessionStateManager:e,taskId:t,afterMessageId:o}){',
  },
];
