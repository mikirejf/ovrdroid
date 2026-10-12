import type { Patch } from './patches.ts';

export const CHAT_INPUT_CALLBACKS = [
  'onSubmit',
  'onInputChange',
  'onCursorPositionChange',
  'onModelCycle',
  'onWarning',
  'onCopied',
  'onDownArrowAtBottom',
] as const;

const SAME_FLAT_OBJECT =
  'function $ODsame($ODx,$ODy){' +
  'if($ODx===$ODy)return!0;' +
  'if($ODx===null||$ODy===null||typeof $ODx!=="object"||typeof $ODy!=="object")return!1;' +
  'if(Object.getPrototypeOf($ODx)!==Object.prototype||Object.getPrototypeOf($ODy)!==Object.prototype)return!1;' +
  'let $ODk=Object.keys($ODx);' +
  'return $ODk.length===Object.keys($ODy).length&&$ODk.every(($ODj)=>Object.hasOwn($ODy,$ODj)&&$ODx[$ODj]===$ODy[$ODj])}';

const SAME_PROPS =
  'function $ODpropsEq($ODa,$ODb){' +
  'let $ODk=Object.keys($ODa);' +
  'return $ODk.length===Object.keys($ODb).length&&$ODk.every(($ODj)=>Object.hasOwn($ODb,$ODj)&&$ODsame($ODa[$ODj],$ODb[$ODj]))}';

const FOOTER_KEY =
  'function $ODfootKey($ODusage){' +
  'return(C().getShowTokenUsageIndicator()&&$ODusage>0?sue($ODusage):"")+"|"+C().getNerdFont()}';

const CHAT_INPUT_WRAPPER =
  'var $ODHm=SA(Hc);' +
  'function $ODIn($ODp){' +
  'let $ODr=b(null);' +
  'if($ODr.current===null){$ODr.current={props:$ODp,calls:{}};' +
  `for(let $ODk of ${JSON.stringify(CHAT_INPUT_CALLBACKS)})` +
  '$ODr.current.calls[$ODk]=(...$ODa)=>$ODr.current.props[$ODk]?.(...$ODa)}' +
  '$ODr.current.props=$ODp;' +
  'let $ODn={...$ODp};' +
  'for(let $ODk of Object.keys($ODr.current.calls))if(typeof $ODp[$ODk]==="function")$ODn[$ODk]=$ODr.current.calls[$ODk];' +
  'return t($ODHm,$ODn)}';

const FOOTER_CALL =
  't(F7,{width:Wa,chatDraftEmpty:rn&&!Kl(Lo),timerState:he,statusState:Fi,sessionId:Ws,lastTokenUsage:Bv,';

const PROGRESS_UPDATES =
  '_e=j?.map(($t)=>({...$t,text:$e($t.text),error:$e($t.error),details:$e($t.details),valueSnippet:$e($t.valueSnippet),fullOutput:$e($t.fullOutput),parameters:Ee($t.parameters)}))';

export const rerenderPatches: readonly Patch[] = [
  {
    name: 'pr-state-same-skip',
    find: 'publish(t){return this.setState(t),t}setState(t){this.state=t,this.emitStateChange()}',
    replace:
      'publish(t){return this.setState(t),t}' +
      'setState(t){let $ODo=this.state,$ODk=Object.keys(t);' +
      'if($ODk.length===Object.keys($ODo).length&&$ODk.every(($ODj)=>Object.hasOwn($ODo,$ODj)&&t[$ODj]===$ODo[$ODj]))return;' +
      'this.state=t,this.emitStateChange()}',
  },
  {
    name: 'footer-memo',
    find: 'o4.displayName="MessageList";',
    lookups: [
      'var o4=SA(({groupedMessages:f,',
      'function F7({width:f,chatDraftEmpty:y,timerState:E,',
      'function FV({sessionId:f,modelId:y,reasoningEffort:E,width:A,lastTokenUsage:D,prState:O}){',
      'function sae({processCount:f,agentCount:y}){',
      'function LW({sessionId:f,width:y}){let{t:E}=J();if(!F2(',
      'function sue(f){if(f===null||f===0)return null;',
      're=C().getShowTokenUsageIndicator()&&E!==null',
    ],
    replace:
      'o4.displayName="MessageList";' +
      `${SAME_FLAT_OBJECT}${SAME_PROPS}${FOOTER_KEY}` +
      'F7=SA(F7,$ODpropsEq);FV=SA(FV);sae=SA(sae);LW=SA(LW);',
  },
  {
    name: 'footer-memo-key',
    find: FOOTER_CALL,
    replace: `${FOOTER_CALL}$ODfresh:$ODfootKey(Bv),`,
  },
  {
    name: 'chat-input-stable',
    find: 'a8.displayName="InputLine";function Hc({',
    lookups: [
      'var a8=SA(s8,(f,y)=>{',
      'To=b({showSuggestions:',
      't(E0,{id:"ChatInput",children:t(Hc,{',
    ],
    replace: `a8.displayName="InputLine";${CHAT_INPUT_WRAPPER}function Hc({`,
  },
  {
    name: 'chat-input-stable-use',
    find: 't(E0,{id:"ChatInput",children:t(Hc,{',
    replace: 't(E0,{id:"ChatInput",children:t($ODIn,{',
  },
  {
    name: 'model-cycle-memo-key',
    find: 'rb=B(()=>C().getModelCycleCandidates(yC,ob?.filter((we)=>we.isCustom).map((we)=>we.id)),[yC,zX,ob])',
    replace:
      'rb=B(()=>C().getModelCycleCandidates(yC,ob?.filter((we)=>we.isCustom).map((we)=>we.id)),[yC.join("\\x00"),zX,ob])',
  },
  {
    name: 'tool-progress-sanitize-cache',
    find: PROGRESS_UPDATES,
    replace:
      '_e=j?.map(($t)=>{let $ODcache=globalThis.$ODprogressSane??=new WeakMap,$ODhit=$ODcache.get($t);' +
      'if($ODhit!==void 0)return $ODhit;' +
      '$ODhit={...$t,text:$e($t.text),error:$e($t.error),details:$e($t.details),valueSnippet:$e($t.valueSnippet),fullOutput:$e($t.fullOutput),parameters:Ee($t.parameters)};' +
      '$ODcache.set($t,$ODhit);return $ODhit})',
  },
  {
    name: 'progress-notify-100ms',
    find: 'static COALESCED_NOTIFY_FALLBACK_MS=50;',
    replace: 'static COALESCED_NOTIFY_FALLBACK_MS=100;',
  },
];
