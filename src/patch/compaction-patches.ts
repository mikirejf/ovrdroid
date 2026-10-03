import type { Patch } from './patches.ts';
import { USAGE_LOG_OPEN } from './usage-patches.ts';

export const REUSE_GLOBAL = '__odReuse';

const EXTENDER_KEY = 'odExtend';

export const ASK_ID_PREFIX = 'od-compaction-';

export const SUMMARIZE_LINE =
  'This message is a system request, not part of the conversation, so do not mention it. ' +
  'Summarize the entire conversation above in the required <summary> format and call no tools. ' +
  "Where the format asks for the user's latest message, use the last user message before this request.";

export const CUSTOM_INSTRUCTIONS_LEAD =
  'The user has provided the following instructions for this summary:';

const INSTRUCTION =
  `y+${JSON.stringify(`\n\n${SUMMARIZE_LINE}`)}` +
  `+(O?${JSON.stringify(`\n\n${CUSTOM_INSTRUCTIONS_LEAD}\n`)}+O:"")`;

const EXTEND =
  '($ODsnap,$ODunseen,$ODtext)=>{' +
  `let $ODnow=Date.now(),$ODask={id:"${ASK_ID_PREFIX}"+$ODnow,role:"user",content:[{type:"text",text:$ODtext}],createdAt:$ODnow,updatedAt:$ODnow},` +
  `$ODbuilt=$ODsnap.${EXTENDER_KEY}($ODask),$ODprefix=$ODsnap.preparedHistory,` +
  '$ODkey=($ODmsg)=>JSON.stringify([$ODmsg.role,$ODmsg.content],($ODk,$ODv)=>$ODk==="cache_control"?void 0:$ODv);' +
  'if($ODbuilt.length<=$ODprefix.length||$ODbuilt.at(-1).id!==$ODask.id||' +
  '$ODprefix.some(($ODmsg,$ODat)=>$ODkey($ODmsg)!==$ODkey($ODbuilt[$ODat])))return"prefix-mismatch";' +
  'let $ODtail=$ODbuilt.slice($ODprefix.length,-1),$ODids=new Set($ODtail.map(($ODmsg)=>$ODmsg.id));' +
  'if($ODunseen.some(($ODmsg)=>!$ODids.has($ODmsg.id)))return"unseen-messages";' +
  'return[...$ODprefix,...$ODtail]}';

const LOG =
  '$ODlog=($ODhow)=>{try{' +
  `${USAGE_LOG_OPEN}__odUsage({t:Date.now(),s:r,m:U.modelId,compact:$ODhow})}catch{}}`;

const REUSE =
  '$ODreuse=async(U)=>{' +
  `let ${LOG},$ODsnap=globalThis.${REUSE_GLOBAL}.snapshot(r);` +
  'if(!$ODsnap){$ODlog("no-snapshot");return}' +
  'if($ODsnap.modelId!==U.modelId){$ODlog("other-model");return}' +
  `let $ODtext=${INSTRUCTION},` +
  '$ODunseen=i.filter(($ODmsg)=>$ODmsg.content?.length&&!$ODsnap.citableMessageIds.has($ODmsg.id)),' +
  '$ODcore=Zi({emitLlmRetryStatus:!0,tools:$ODsnap.tools}),$ODsend=$ODcore.sendMessage,$ODseen,' +
  '$ODstop=()=>$ODcore.abortStreaming(),$ODhow;' +
  '$ODcore.sendMessage=async($ODarg)=>$ODseen=await $ODsend($ODarg);' +
  'b?.addEventListener("abort",$ODstop,{once:!0});' +
  `try{let $ODhist=$ODunseen.length?globalThis.${REUSE_GLOBAL}.extend($ODsnap,$ODunseen,$ODtext):$ODsnap.preparedHistory;` +
  'if(typeof $ODhist==="string")$ODhow=$ODhist;else{' +
  `let $ODres=await globalThis.${REUSE_GLOBAL}.send($ODcore,{modelId:$ODsnap.modelId,isSpecMode:$ODsnap.isSpecMode,` +
  'reasoningEffort:$ODsnap.reasoningEffort,systemMessage:$ODsnap.systemMessage,preparedHistory:$ODhist,' +
  'instruction:$ODtext,maxTokensOverride:u,sessionId:r});' +
  'if(b?.aborted)throw new DOMException("Compaction aborted","AbortError");' +
  'if(!$ODres.content)$ODhow="empty";else if($ODseen?.toolUses?.length)$ODhow="tool-call";' +
  'else{$ODlog($ODunseen.length?"reuse-extended":"reuse");return $ODres}}}' +
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
      `globalThis.${REUSE_GLOBAL}={snapshot:h4,send:Jte,extend:${EXTEND}};`,
  },
  {
    name: 'compaction-reuse-extender',
    find: 'capturedAt:Date.now()};DJ(jn);',
    lookups: ['mt=un({rawHistory:xe,lastSummary:this.lastSummaryRef,reminders:[Rt,qo,bt]})'],
    replace:
      `capturedAt:Date.now(),${EXTENDER_KEY}:(($ODrem,$ODsum)=>($ODask)=>this.llmCore.prepareMessagesWithCaching(` +
      'un({rawHistory:[...this.params.getConversationHistory(),$ODask],lastSummary:$ODsum,reminders:$ODrem})))' +
      '([Rt,qo,bt],this.lastSummaryRef)};DJ(jn);',
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
