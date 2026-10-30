import type { Patch } from './patches.ts';
import {
  HEADING_FLAGS,
  HEADING_SOURCE,
  MIN_SUMMARY_SECTIONS,
  PARENT_BRIEF_LEAD,
  PARENT_NOTE,
  SUMMARY_SECTIONS,
  SUMMARY_TAG,
} from './summary-format.ts';
import { USAGE_LOG_OPEN } from './usage-patches.ts';

export const REUSE_GLOBAL = '__odReuse';

const EXTENDER_KEY = 'odExtend';

export const ASK_ID_PREFIX = 'od-compaction-';

const SYSTEM_REQUEST = 'This message is a system request, not part of the conversation';

const SUMMARIZE_ORDER =
  'Summarize the entire conversation above in the required <summary> format and call no tools. ' +
  "Where the format asks for the user's latest message, use the last user message before this request.";

export const SUMMARIZE_LINE = `${SYSTEM_REQUEST}, so do not mention it. ${SUMMARIZE_ORDER}`;

export const NO_MENTION_LINE = `${SYSTEM_REQUEST}. ${SUMMARIZE_ORDER}`;

const CLAUDE_MODEL_SOURCE = 'claude|haiku|sonnet|opus';

export const NOT_SUMMARY_HEAD_CHARS = 600;

export const CUSTOM_INSTRUCTIONS_LEAD =
  'The user has provided the following instructions for this summary:';

const INSTRUCTION =
  `B+(new RegExp(${JSON.stringify(CLAUDE_MODEL_SOURCE)},"i").test($ODsnap.modelId)` +
  `?${JSON.stringify(`\n\n${NO_MENTION_LINE}`)}:${JSON.stringify(`\n\n${SUMMARIZE_LINE}`)})` +
  `+(k?${JSON.stringify(`\n\n${CUSTOM_INSTRUCTIONS_LEAD}\n`)}+k:"")`;

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
  '$ODlog=($ODhow,$ODhead)=>{try{' +
  `${USAGE_LOG_OPEN}__odUsage({t:Date.now(),s:r,m:$ODattempt.modelId,compact:$ODhow,...$ODhead?{head:$ODhead}:{}})}catch{}}`;

const IS_SUMMARY =
  `$ODisSummary=($ODbody,$ODlower=$ODbody.toLowerCase())=>$ODlower.includes(${JSON.stringify(SUMMARY_TAG)})||new Set([...$ODlower.matchAll(` +
  `new RegExp(${JSON.stringify(HEADING_SOURCE)},${JSON.stringify(HEADING_FLAGS)}))].flatMap(([,$ODheading=""])=>` +
  `${JSON.stringify(SUMMARY_SECTIONS)}.filter(($ODsection)=>$ODheading.startsWith($ODsection)))).size>=${MIN_SUMMARY_SECTIONS}`;

const REUSE =
  '$ODreuse=async($ODattempt)=>{' +
  `let ${LOG},${IS_SUMMARY},$ODsnap=globalThis.${REUSE_GLOBAL}.snapshot(r);` +
  'if(!$ODsnap){$ODlog("no-snapshot");return}' +
  'if($ODsnap.modelId!==$ODattempt.modelId){$ODlog("other-model");return}' +
  `let $ODtext=${INSTRUCTION},` +
  '$ODunseen=s.filter(($ODmsg)=>$ODmsg.content?.length&&!$ODsnap.citableMessageIds.has($ODmsg.id)),' +
  '$ODcore=ta({emitLlmRetryStatus:!0,tools:$ODsnap.tools}),$ODsend=$ODcore.sendMessage,$ODseen,' +
  '$ODstop=()=>$ODcore.abortStreaming(),$ODhow,$ODhead;' +
  '$ODcore.sendMessage=async($ODarg)=>$ODseen=await $ODsend($ODarg);' +
  'S?.addEventListener("abort",$ODstop,{once:!0});' +
  `try{let $ODhist=$ODunseen.length?globalThis.${REUSE_GLOBAL}.extend($ODsnap,$ODunseen,$ODtext):$ODsnap.preparedHistory;` +
  'if(typeof $ODhist==="string")$ODhow=$ODhist;else{y?.($ODsnap.modelId);' +
  `let $ODres=await globalThis.${REUSE_GLOBAL}.send($ODcore,{modelId:$ODsnap.modelId,isSpecMode:$ODsnap.isSpecMode,` +
  'reasoningEffort:$ODsnap.reasoningEffort,systemMessage:$ODsnap.systemMessage,preparedHistory:$ODhist,' +
  'instruction:$ODtext,maxTokensOverride:fe,sessionId:r});' +
  'if(S?.aborted)throw new DOMException("Compaction aborted","AbortError");' +
  'if(!$ODres.content)$ODhow="empty";else if($ODseen?.toolUses?.length)$ODhow="tool-call";' +
  `else if(!$ODisSummary($ODres.content))$ODhow="not-summary",$ODhead=$ODres.content.slice(0,${NOT_SUMMARY_HEAD_CHARS});` +
  'else{$ODlog($ODunseen.length?"reuse-extended":"reuse");return $ODres}}}' +
  'catch($ODerr){if(S?.aborted)throw $ODerr;$ODhow="error"}' +
  'finally{S?.removeEventListener("abort",$ODstop)}' +
  '$ODlog($ODhow,$ODhead);if(S?.aborted)throw new DOMException("Compaction aborted","AbortError")}';

const STOCK_SEND_HEAD = 'me=async(W)=>{';

const STOCK_SEND_BODY =
  'let L=z(W).userContent;return y?.(W.modelId),await hl(g,{providerRoutingOperation:X,systemPrompt:B,userContent:L,modelId:W.modelId,maxTokensOverride:fe,sessionId:r,abortSignal:S,';

const PARENT_BRIEF =
  'try{if(J.getCallingSessionId(a)){' +
  'let $ODbrief=(await J.getAllMessageEvents(a))' +
  '.flatMap(($ODevent)=>$ODevent.message.role==="user"?$ODevent.message.content:[])' +
  '.find(($ODblock)=>$ODblock.type==="text"&&$ODblock.text&&!$ODblock.text.startsWith("<system-reminder>"))?.text;' +
  `ae+="\\n\\n"+($ODbrief?${JSON.stringify(PARENT_BRIEF_LEAD)}+"\\n\\n"+$ODbrief+"\\n\\n":"")+${JSON.stringify(PARENT_NOTE)}}}catch{}`;

const SUMMARIZER_END =
  'return s("[Compaction] Summarizer response OK, extracted summary",{length:ae.length}),ae}}';

export const compactionPatches: readonly Patch[] = [
  {
    name: 'compaction-reuse-exports',
    find: 'function wZ(t,o=LJ){let a=yi.get(t)?.snapshot;if(!a)return;if(Date.now()-a.capturedAt>o)return;return a}',
    replace:
      'function wZ(t,o=LJ){let a=yi.get(t)?.snapshot;if(!a)return;if(Date.now()-a.capturedAt>o)return;return a}' +
      `Object.assign(globalThis.${REUSE_GLOBAL}??={},{snapshot:wZ,extend:${EXTEND}});`,
  },
  {
    name: 'compaction-reuse-send',
    find: 'async function Jte(t,{systemMessage:o,preparedHistory:i,instruction:c,...l}){',
    replace:
      `(globalThis.${REUSE_GLOBAL}??={}).send=Jte;` +
      'async function Jte(t,{systemMessage:o,preparedHistory:i,instruction:c,...l}){',
  },
  {
    name: 'compaction-reuse-extender',
    find: 'capturedAt:Date.now()};DJ(jn);',
    lookups: [
      'Nn({rawHistory:Pe,lastSummary:this.lastSummaryRef,reminders:[VU(yo,br()),un,Pt]})',
      'prepareMessagesWithCaching(Do,{sessionId:v,modelId:We})',
    ],
    replace:
      `capturedAt:Date.now(),${EXTENDER_KEY}:(($ODrem,$ODopts,$ODsum)=>($ODask)=>this.llmCore.prepareMessagesWithCaching(` +
      'Nn({rawHistory:[...this.params.getConversationHistory(),$ODask],lastSummary:$ODsum,reminders:$ODrem}),$ODopts))' +
      '([VU(yo,br()),un,Pt],{sessionId:v,modelId:We},this.lastSummaryRef)};DJ(jn);',
  },
  {
    name: 'compaction-reuse-prefix',
    find: `${STOCK_SEND_HEAD}${STOCK_SEND_BODY}`,
    lookups: [
      'g=ta({emitLlmRetryStatus:!0})',
      'customInstructions:k,contextLimitFallbackModelId:E,onModelRequest:y}){',
      'return async function({messages:s,sessionId:r,previousSummary:a,',
    ],
    replace: `$ODfirst=!0,${REUSE},${STOCK_SEND_HEAD}if($ODfirst){$ODfirst=!1;let $ODdone=await $ODreuse(W);if($ODdone)return $ODdone}${STOCK_SEND_BODY}`,
  },
  {
    name: 'compaction-parent-brief',
    find: SUMMARIZER_END,
    lookups: [
      'J=p(),T=F.getCompactionModel()',
      'return async function({messages:r,sessionId:a,previousSummary:d,',
    ],
    replace: `${PARENT_BRIEF}${SUMMARIZER_END}`,
  },
];
