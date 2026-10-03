import type { Patch } from './patches.ts';
import { USAGE_LOG_OPEN } from './usage-patches.ts';

export const REUSE_GLOBAL = '__odReuse';

export const SUMMARIZE_LINE =
  'This message is a system request, not part of the conversation, so do not mention it. ' +
  'Summarize the entire conversation above in the required <summary> format and call no tools.';

export const CUSTOM_INSTRUCTIONS_LEAD =
  'The user has provided the following instructions for this summary:';

const INSTRUCTION =
  `y+${JSON.stringify(`\n\n${SUMMARIZE_LINE}`)}` +
  `+(O?${JSON.stringify(`\n\n${CUSTOM_INSTRUCTIONS_LEAD}\n`)}+O:"")`;

const LOG =
  '$ODlog=($ODhow)=>{try{' +
  `${USAGE_LOG_OPEN}__odUsage({t:Date.now(),s:r,m:U.modelId,compact:$ODhow})}catch{}}`;

const REUSE =
  '$ODreuse=async(U)=>{' +
  `let ${LOG},$ODsnap=globalThis.${REUSE_GLOBAL}.snapshot(r);` +
  'if(!$ODsnap){$ODlog("no-snapshot");return}' +
  'if($ODsnap.modelId!==U.modelId){$ODlog("other-model");return}' +
  'if(i.some(($ODmsg)=>!$ODsnap.citableMessageIds.has($ODmsg.id))){$ODlog("unseen-messages");return}' +
  'let $ODcore=Zi({emitLlmRetryStatus:!0,tools:$ODsnap.tools}),$ODsend=$ODcore.sendMessage,$ODseen,' +
  '$ODstop=()=>$ODcore.abortStreaming(),$ODhow;' +
  '$ODcore.sendMessage=async($ODarg)=>$ODseen=await $ODsend($ODarg);' +
  'b?.addEventListener("abort",$ODstop,{once:!0});' +
  `try{let $ODres=await globalThis.${REUSE_GLOBAL}.send($ODcore,{modelId:$ODsnap.modelId,isSpecMode:$ODsnap.isSpecMode,` +
  'reasoningEffort:$ODsnap.reasoningEffort,systemMessage:$ODsnap.systemMessage,preparedHistory:$ODsnap.preparedHistory,' +
  `instruction:${INSTRUCTION},maxTokensOverride:u,sessionId:r});` +
  'if(b?.aborted)throw new DOMException("Compaction aborted","AbortError");' +
  'if(!$ODres.content)$ODhow="empty";else if($ODseen?.toolUses?.length)$ODhow="tool-call";' +
  'else{$ODlog("reuse");return $ODres}}' +
  'catch($ODerr){if(b?.aborted)throw $ODerr;$ODhow="error"}' +
  'finally{b?.removeEventListener("abort",$ODstop)}' +
  '$ODlog($ODhow);if(b?.aborted)throw new DOMException("Compaction aborted","AbortError")}';

const STOCK_SEND =
  'as(J,{systemPrompt:y,userContent:ie(U).userContent,modelId:U.modelId,maxTokensOverride:u,sessionId:r,abortSignal:b,isSpecMode:_.isSpecMode(),...U.reasoningEffort?{reasoningEffort:U.reasoningEffort}:{}})';

export const compactionPatches: readonly Patch[] = [
  {
    name: 'compaction-reuse-exports',
    find: 'function h4(t,o=eN){let i=zh.get(t);if(!i)return;if(Date.now()-i.capturedAt>o)return;return i}',
    lookups: [
      'async function Jte(t,{systemMessage:o,preparedHistory:i,instruction:c,...l}){let g=Date.now(),',
    ],
    replace:
      'function h4(t,o=eN){let i=zh.get(t);if(!i)return;if(Date.now()-i.capturedAt>o)return;return i}' +
      `globalThis.${REUSE_GLOBAL}={snapshot:h4,send:Jte};`,
  },
  {
    name: 'compaction-reuse-prefix',
    find: `Ie=async(U)=>await ${STOCK_SEND}`,
    lookups: [
      'J=Zi({emitLlmRetryStatus:!0})',
      'customInstructions:O,contextLimitFallbackModelId:k}){',
      'return async function({messages:i,sessionId:r,previousSummary:l,',
    ],
    replace: `$ODfirst=!0,${REUSE},Ie=async(U)=>{if($ODfirst){$ODfirst=!1;let $ODdone=await $ODreuse(U);if($ODdone)return $ODdone}return await ${STOCK_SEND}}`,
  },
];
