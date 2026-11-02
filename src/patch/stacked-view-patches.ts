import type { Patch } from './patches.ts';

export const STACKED_MODE = 'stacked';

export const INLINE_TOOLS: readonly string[] = [
  'Edit',
  'MultiEdit',
  'Create',
  'ApplyPatch',
  'TodoWrite',
  'Task',
  'SpawnAgent',
  'AskUser',
  'ProposeWorkstream',
  'ExitSpecMode',
  'RecommendMission',
  'ProposeMission',
  'StartMissionRun',
  'SelectFeature',
  'EndFeatureRun',
  'DismissHandoffItems',
  'StageSettingsChanges',
  'GenerateImage',
  'ConnectApp',
];

export const CALL_NOUNS: readonly (readonly [string, string])[] = [
  ['Read', 'file'],
  ['Grep', 'search'],
  ['Glob', 'pattern'],
  ['LS', 'directory'],
  ['WebSearch', 'search'],
  ['FetchUrl', 'URL'],
  ['Execute', 'command'],
];

export const TABLES =
  `var $ODinlineTools=new Set(${JSON.stringify(INLINE_TOOLS)}),` +
  `$ODcallNouns=new Map(${JSON.stringify(CALL_NOUNS)});`;

export const HOOKS_SHOW =
  'function $ODhooksShow($ODh){' +
  'return $ODh!==void 0&&f().getShowHookOutput()&&!uD($ODh)&&[$ODh.before,$ODh.after].some(($ODl)=>$ODl.length>0&&!cw($ODl))}';

export const RUN_CALLS =
  'function $ODrunCalls($ODu){' +
  'if($ODu.pinnedToStatic===!0)return;' +
  'if($ODhooksShow($ODu.kind==="collapsed-group"?$ODu.group.associatedHooks:$ODu.associatedHooks))return;' +
  'let $ODcalls=$ODu.kind==="collapsed-group"?$ODu.group.tools:$ODu.kind==="item"&&va($ODu.item)?[$ODu.item]:void 0;' +
  'if($ODcalls?.every(($ODc)=>!$ODinlineTools.has($ODc.toolName)))return $ODcalls}';

export const DRAWS_NOTHING =
  'function $ODdrawsNothing($ODu,$ODopts){' +
  'return $ODu.kind==="item"&&iD($ODu.item,80,void 0,$ODopts.showThinking,$ODhooksShow($ODu.associatedHooks)?{associatedHooks:$ODu.associatedHooks}:{})===null}';

export const RUN_UNIT =
  'function $ODrunUnit($ODrun,$ODopen){' +
  'let $ODfirst=$ODrun.calls[0].id;' +
  'return{kind:"collapsed-group",unitId:"collapsed-group:"+$ODfirst,sourceIds:$ODrun.ids,signature:"stacked:"+$ODrun.ids.join(","),' +
  'group:{kind:"collapsed-tool-group",id:"tool-group-"+$ODfirst,toolName:$ODrun.calls[0].toolName,tools:$ODrun.calls,' +
  '$ODstack:!0,$ODopen:$ODopen,$ODlive:$ODopen||$ODrun.calls.some(($ODc)=>$ODc.sourceMessageStreaming===!0)}}}';

export const SUMMARIZE = String.raw`function $ODsummarize($ODtext){let $ODheads=[...$ODtext.matchAll(/^[^\S\n]*\*\*([^*\n]+)\*\*[^\S\n]*$/gm)],$ODline=$ODheads.length>0?$ODheads.at(-1)[1]:$ODtext.replaceAll("**","").trim().split(/(?<=[.?!])\s|\n/)[0];return $ODline.replace(/\s+/g," ").trim()}`;

export const THINKING_ROWS = 3;

export const THINKING_ROW =
  'function $ODThinkingRow({block:$ODb,contentWidth:$ODw}){' +
  'let $ODtext=$ODb.type==="redacted_thinking"?u().t("common:thinking.contentEncrypted"):$ODsummarize($ODb.thinking||"");' +
  'if(!$ODtext)return null;' +
  `return t(c,{marginLeft:3,width:Math.max(1,$ODw-3),maxHeight:${THINKING_ROWS},overflow:"hidden",children:` +
  't(o,{color:a.text.muted,italic:!0,wrap:"wrap",children:u().t("common:thinking.thinkingLabel")+" "+$ODtext})})}';

export const STACK =
  'function $ODstack($ODunits,$ODopts){' +
  'let $ODout=[],$ODrun;' +
  'for(let $ODu of $ODunits){' +
  'if($ODdrawsNothing($ODu,$ODopts)){$ODout.push($ODu);continue}' +
  'if($ODu.kind==="item"&&!va($ODu.item)&&$ODu.item.messageType==="thinking"&&$ODu.item.thinkingBlock!==void 0){' +
  '$ODrun=void 0,$ODout.push({...$ODu,item:{...$ODu.item,$ODsummary:!0}});continue}' +
  'let $ODcalls=$ODrunCalls($ODu);' +
  'if($ODcalls?.some(($ODc)=>$ODopts.awaiting($ODc.id))){$ODout.push($ODu);continue}' +
  'if($ODcalls){if(!$ODrun)$ODrun={$ODrun:!0,calls:[],ids:[]},$ODout.push($ODrun);$ODrun.calls.push(...$ODcalls),$ODrun.ids.push(...$ODu.sourceIds);continue}' +
  '$ODrun=void 0,$ODout.push($ODu)}' +
  'return $ODout.map(($ODu)=>$ODu.$ODrun===!0?$ODrunUnit($ODu,$ODu===$ODrun&&$ODopts.open):$ODu)}';

export const SUBTITLE =
  'function $ODsubtitle($ODc){' +
  'if($ODc.toolName!=="Execute")return Jxe($ODc);' +
  'let $ODcmd=$ODc.toolInput?.command;' +
  'return typeof $ODcmd==="string"?$ODcmd.split("\\n").map(($ODp)=>$ODp.trim()).filter(Boolean).join(" ")||null:null}';

export const SEGMENTS =
  'function $ODsegments($ODtools){' +
  'let $ODout=[];' +
  'for(let $ODc of $ODtools){let $ODlast=$ODout.at(-1);if($ODlast?.[0]===$ODc.toolName)$ODlast[1].push($ODc);else $ODout.push([$ODc.toolName,[$ODc]])}' +
  'return $ODout}';

export const STACK_VIEW =
  'function $ODStack({group:$ODg}){' +
  'let $ODlist=$ODsegments($ODg.tools),$ODsub=$ODg.$ODopen?$ODsubtitle($ODg.tools.at(-1)):null;' +
  'return l(c,{flexDirection:"column",marginLeft:3,children:[' +
  't(c,{flexDirection:"row",flexWrap:"wrap",children:$ODlist.map(([$ODname,$ODcalls],$ODi)=>{' +
  'let $ODfailed=$ODcalls.filter(($ODc)=>$ODc.isError===!0).length,$ODstate=cbe($ODcalls),$ODcount=$ODcalls.length,' +
  '$ODsep=$ODi<$ODlist.length-1?t(o,{color:a.text.muted,children:" \\u203A "}):null;' +
  'return l(c,{children:[t(S2,{text:Uu($ODname),isPending:$ODstate==="active",color:$ODstate==="not-executed"?a.text.muted:Xxe}),' +
  't(o,{color:VW,children:" "+$ODcount+" "+LA($ODcallNouns.get($ODname)??"call",$ODcount)}),' +
  '$ODfailed>0?t(o,{color:a.error,children:", "+$ODfailed+" failed"}):null,$ODsep]},$ODi)})}),' +
  '$ODsub?t(c,{marginLeft:1,children:t(o,{color:a.text.muted,wrap:"truncate-end",children:"\\u21B3 "+zW($ODsub)})}):null]})}';

const UNITS_FIND =
  'xe=f().getToolResultDisplay()==="compact",ue=b({staticKey:M,cuts:new Map}),' +
  'Ce=k(()=>{let We=ue.current.staticKey===M?ue.current.cuts:new Map,gt=Nz(We,ie.filter((tt)=>!(("toolName"in tt)&&("status"in tt))));return ue.current={staticKey:M,cuts:gt},gt},[ie,M]),';

const UNITS_KEY = 'Ne=b(void 0),ke=b(void 0),Fe=b([]),$e=M,';

const UNITS_OPTIONS =
  '{includeHeader:!0,reskin:!0,staticToolIds:le,view:{kind:"chat",showThinking:A},streamingCuts:Ce}';

const UNITS_HEAD = UNITS_FIND.replace(
  'xe=f().getToolResultDisplay()==="compact",',
  `$ODmode=f().getToolResultDisplay(),xe=$ODmode==="compact",$ODstacked=$ODmode==="${STACKED_MODE}",`,
)
  .replace(
    'ie.filter((tt)=>!(("toolName"in tt)&&("status"in tt)))',
    'ie.filter((tt)=>!(("toolName"in tt)&&("status"in tt))&&!($ODstacked&&tt.messageType==="thinking"))',
  )
  .replace('},[ie,M]),', '},[ie,M,$ODstacked]),');

const UNITS_STACKED =
  'return $ODstacked?$ODstack($ODunits,{open:$ODturn,showThinking:A,awaiting:($ODid)=>K?.has($ODid)===!0}):$ODunits}';

const REPRINT_FIND =
  'qe=b({baseStaticKey:$e,epoch:0});ur(()=>{Ne.current=Ye;let We=qe.current,tt=We.baseStaticKey===Ye.baseStaticKey&&Ye.epoch>We.epoch;' +
  'if(qe.current={baseStaticKey:Ye.baseStaticKey,epoch:Ye.epoch},tt)ee?.()},[Ye,ee]);';

export const REPRINT = REPRINT_FIND.replace(
  'qe=b({baseStaticKey:$e,epoch:0})',
  'qe=b({baseStaticKey:$e,epoch:0,$ODstacked:$ODstacked})',
)
  .replace('&&Ye.epoch>We.epoch;', '&&Ye.epoch>We.epoch||We.$ODstacked!==$ODstacked;')
  .replace('epoch:Ye.epoch}', 'epoch:Ye.epoch,$ODstacked:$ODstacked}');

export const stackedViewPatches: readonly Patch[] = [
  {
    name: 'stacked-view-setting-value',
    find: 'var $ce;((a)=>{a.Expanded="expanded";a.Compact="compact"})($ce||={});',
    replace:
      'var $ce;((a)=>{a.Expanded="expanded";a.Compact="compact";a.Stacked="stacked"})($ce||={});',
  },
  {
    name: 'stacked-view-setting-cycle',
    find: 'action:()=>{let Xe=Io()==="expanded"?"compact":"expanded";f().setToolResultDisplay(Xe)',
    replace:
      'action:()=>{let Xe=Io()==="expanded"?"compact":Io()==="compact"?"stacked":"expanded";f().setToolResultDisplay(Xe)',
  },
  {
    name: 'stacked-view-setting-label',
    find: 'function QD(g,y){return g==="expanded"?',
    replace: 'function QD(g,y){return g==="stacked"?"Stacked":g==="expanded"?',
  },
  {
    name: 'stacked-view-helpers',
    find: 'var Xxe=a.toolName,VW=a.toolParam;',
    lookups: [
      'function va(g){return"toolName"in g&&"status"in g}function b1e(g){return!va(g)&&g.messageType==="hook_execution"',
      'return iD(g,y,void 0,v.showThinking,v)}',
      'function Jxe(g){let y=g.toolInput;if(!y)return null;switch(g.toolName){case"Read":',
      'function zW(g,y){let S=he(g),M=(process.stdout.columns||80)-tbe;',
      'ie=f().getShowHookOutput()&&[re?.before??[],re?.after??[]].some((le)=>le.length>0&&!cw(le));',
      'function uD(g){if(!g)return!1;return(Array.isArray(g)?g:QS(g)).some((S)=>S.hookStatus==="executing")}',
      'function cbe(g){let y=g.map((S)=>Xw({status:S.status,result:S.result,isError:S.isError,executionPhase:S.executionPhase}));',
      'function LA(g,y){if(y===1)return g;if(g==="search")return"searches";',
      're=oe?.name??Uu(v)',
      't(S2,{text:re,isPending:A==="active",color:L}),l(o,{color:VW,children:[" ",ie," ",LA(le,ie)]}),q>0&&t(o,{color:a.error',
      'if(vM(g))return t(c,{width:"100%",marginTop:1,',
      'u().t("common:thinking.contentEncrypted")',
    ],
    replace:
      `var Xxe=a.toolName,VW=a.toolParam;${TABLES}` +
      `${HOOKS_SHOW}${RUN_CALLS}${DRAWS_NOTHING}${RUN_UNIT}${SUMMARIZE}${THINKING_ROW}${STACK}${SUBTITLE}${SEGMENTS}${STACK_VIEW}`,
  },
  {
    name: 'stacked-view-draw',
    find: 'if(vM(g))return t(c,{width:"100%",marginTop:1,children:t(iM,{group:g,contentWidth:y,compact:v.compact})}',
    replace:
      'if(vM(g))return t(c,{width:"100%",marginTop:1,children:g.$ODstack===!0?t($ODStack,{group:g}):t(iM,{group:g,contentWidth:y,compact:v.compact})}',
  },
  {
    name: 'stacked-view-thinking-row',
    find: 'if(g.messageType==="thinking"&&g.thinkingBlock){if(!S)return null;return t(oV,{thinking:{thinkingBlocks:[g.thinkingBlock]},contentWidth:y,',
    replace:
      'if(g.messageType==="thinking"&&g.thinkingBlock){if(!S)return null;if(g.$ODsummary===!0)return t($ODThinkingRow,{block:g.thinkingBlock,contentWidth:y});return t(oV,{thinking:{thinkingBlocks:[g.thinkingBlock]},contentWidth:y,',
  },
  {
    name: 'stacked-view-open-run-live',
    find: 'function Xz(g){return(g.kind==="item"||g.kind==="proposal-body")&&g.item.sourceMessageStreaming===!0}',
    replace:
      'function Xz(g){return g.kind==="collapsed-group"&&g.group.$ODlive===!0||(g.kind==="item"||g.kind==="proposal-body")&&g.item.sourceMessageStreaming===!0}',
  },
  {
    name: 'stacked-view-turn-prop',
    find: 'showThinking:A=!1,permissionToolIds:L,staticToolIds:V,pendingPermissionToolIds:K,',
    replace:
      'showThinking:A=!1,$ODturn:$ODturn=!1,permissionToolIds:L,staticToolIds:V,pendingPermissionToolIds:K,',
  },
  {
    name: 'stacked-view-units',
    find: `${UNITS_FIND}Ie=k(()=>t0(ie,${UNITS_OPTIONS}),[le,ie,A,Ce]),${UNITS_KEY}`,
    lookups: ['showThinking:A=!1,permissionToolIds:L,staticToolIds:V,pendingPermissionToolIds:K,'],
    replace: `${UNITS_HEAD}Ie=k(()=>{let $ODunits=t0(ie,${UNITS_OPTIONS});${UNITS_STACKED},[le,ie,A,Ce,$ODstacked,$ODturn,K]),${UNITS_KEY.replace('$e=M,', '$e=$ODstacked?M+":stacked":M,')}`,
  },
  {
    name: 'stacked-view-mode-reprint',
    find: REPRINT_FIND,
    replace: REPRINT,
  },
  {
    name: 'stacked-view-turn-running',
    find: 'liveTailMaxRows:Lr.activePane?FM:Tre,onStaticEpochReset:Vr,',
    lookups: ['xs=bD(SP),rb=xs!=="idle"'],
    replace: 'liveTailMaxRows:Lr.activePane?FM:Tre,$ODturn:rb,onStaticEpochReset:Vr,',
  },
];
