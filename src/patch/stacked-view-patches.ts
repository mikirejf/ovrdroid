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

export const RUN_CALLS =
  'function $ODrunCalls($ODu,$ODopts){' +
  'if($ODu.pinnedToStatic===!0)return;' +
  'let $ODcalls=$ODu.kind==="collapsed-group"?$ODu.group.tools:$ODu.kind==="item"&&va($ODu.item)?[$ODu.item]:void 0;' +
  'if($ODcalls?.every(($ODc)=>!$ODinlineTools.has($ODc.toolName)&&!$ODopts.inline($ODc.id)))return $ODcalls}';

export const DRAWS_NOTHING =
  'function $ODdrawsNothing($ODu,$ODopts){return $ODu.kind==="item"&&iD($ODu.item,80,void 0,$ODopts.showThinking,{})===null}';

export const RUN_UNIT =
  'function $ODrunUnit($ODrun,$ODopen){' +
  'let $ODfirst=$ODrun.calls[0].id;' +
  'return{kind:"collapsed-group",unitId:"collapsed-group:"+$ODfirst,sourceIds:$ODrun.ids,signature:"stacked:"+$ODrun.ids.join(","),' +
  'group:{kind:"collapsed-tool-group",id:"tool-group-"+$ODfirst,toolName:$ODrun.calls[0].toolName,tools:$ODrun.calls,' +
  '$ODstack:!0,$ODopen:$ODopen,$ODlive:$ODopen||$ODrun.calls.some(($ODc)=>$ODc.sourceMessageStreaming===!0)}}}';

export const STACK =
  'function $ODstack($ODunits,$ODopts){' +
  'let $ODout=[],$ODrun;' +
  'for(let $ODu of $ODunits){' +
  'if($ODdrawsNothing($ODu,$ODopts)){$ODout.push($ODu);continue}' +
  'let $ODcalls=$ODrunCalls($ODu,$ODopts);' +
  'if($ODcalls){if(!$ODrun)$ODrun={$ODrun:!0,calls:[],ids:[]},$ODout.push($ODrun);$ODrun.calls.push(...$ODcalls),$ODrun.ids.push(...$ODu.sourceIds);continue}' +
  '$ODrun=void 0,$ODout.push($ODu)}' +
  'return $ODout.map(($ODu)=>$ODu.$ODrun===!0?$ODrunUnit($ODu,$ODu===$ODrun&&$ODopts.open):$ODu)}';

export const SUBTITLE =
  'function $ODsubtitle($ODc){' +
  'if($ODc.toolName!=="Execute")return Jxe($ODc);' +
  'let $ODcmd=$ODc.toolInput?.command;' +
  'return typeof $ODcmd==="string"?$ODcmd.split("\\n").map(($ODp)=>$ODp.trim()).filter(Boolean).join(" ")||null:null}';

export const STACK_VIEW =
  'function $ODStack({group:$ODg}){' +
  'let $ODsegs=new Map;' +
  'for(let $ODc of $ODg.tools){let $ODs=$ODsegs.get($ODc.toolName)??[];$ODs.push($ODc),$ODsegs.set($ODc.toolName,$ODs)}' +
  'let $ODlist=[...$ODsegs],$ODsub=$ODg.$ODopen?$ODsubtitle($ODg.tools.at(-1)):null;' +
  'return l(c,{flexDirection:"column",marginLeft:3,children:[' +
  't(c,{flexDirection:"row",flexWrap:"wrap",children:$ODlist.map(([$ODname,$ODcalls],$ODi)=>{' +
  'let $ODfailed=$ODcalls.filter(($ODc)=>$ODc.isError===!0).length,$ODstate=cbe($ODcalls),$ODcount=$ODcalls.length,' +
  '$ODsep=$ODi<$ODlist.length-1?t(o,{color:a.text.muted,children:" \\xB7 "}):null;' +
  'return l(c,{children:[t(S2,{text:Uu($ODname),isPending:$ODstate==="active",color:$ODstate==="not-executed"?a.text.muted:Xxe}),' +
  't(o,{color:VW,children:" "+$ODcount+" "+LA($ODcallNouns.get($ODname)??"call",$ODcount)}),' +
  '$ODfailed>0?t(o,{color:a.error,children:", "+$ODfailed+" failed"}):null,$ODsep]},$ODname)})}),' +
  '$ODsub?t(c,{marginLeft:1,children:t(o,{color:a.text.muted,wrap:"truncate-end",children:"\\u21B3 "+zW($ODsub)})}):null]})}';

const UNITS_FIND =
  'xe=f().getToolResultDisplay()==="compact",ue=b({staticKey:M,cuts:new Map}),' +
  'Ce=k(()=>{let We=ue.current.staticKey===M?ue.current.cuts:new Map,gt=Nz(We,ie.filter((tt)=>!(("toolName"in tt)&&("status"in tt))));return ue.current={staticKey:M,cuts:gt},gt},[ie,M]),';

const UNITS_OPTIONS =
  '{includeHeader:!0,reskin:!0,staticToolIds:le,view:{kind:"chat",showThinking:A},streamingCuts:Ce}';

const UNITS_HEAD = UNITS_FIND.replace(
  'xe=f().getToolResultDisplay()==="compact",',
  `$ODmode=f().getToolResultDisplay(),xe=$ODmode==="compact",$ODstacked=$ODmode==="${STACKED_MODE}",`,
);

const UNITS_STACKED =
  'return $ODstacked?$ODstack($ODunits,{open:$ODturn,showThinking:A,inline:($ODid)=>L?.has($ODid)===!0||K?.has($ODid)===!0||le?.has($ODid)===!0}):$ODunits}';

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
      'function cbe(g){let y=g.map((S)=>Xw({status:S.status,result:S.result,isError:S.isError,executionPhase:S.executionPhase}));',
      'function LA(g,y){if(y===1)return g;if(g==="search")return"searches";',
      're=oe?.name??Uu(v)',
      't(S2,{text:re,isPending:A==="active",color:L}),l(o,{color:VW,children:[" ",ie," ",LA(le,ie)]}),q>0&&t(o,{color:a.error',
      'if(vM(g))return t(c,{width:"100%",marginTop:1,',
    ],
    replace:
      `var Xxe=a.toolName,VW=a.toolParam;${TABLES}` +
      `${RUN_CALLS}${DRAWS_NOTHING}${RUN_UNIT}${STACK}${SUBTITLE}${STACK_VIEW}`,
  },
  {
    name: 'stacked-view-draw',
    find: 'if(vM(g))return t(c,{width:"100%",marginTop:1,children:t(iM,{group:g,contentWidth:y,compact:v.compact})}',
    replace:
      'if(vM(g))return t(c,{width:"100%",marginTop:1,children:g.$ODstack===!0?t($ODStack,{group:g}):t(iM,{group:g,contentWidth:y,compact:v.compact})}',
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
    find: `${UNITS_FIND}Ie=k(()=>t0(ie,${UNITS_OPTIONS}),[le,ie,A,Ce])`,
    lookups: ['showThinking:A=!1,permissionToolIds:L,staticToolIds:V,pendingPermissionToolIds:K,'],
    replace: `${UNITS_HEAD}Ie=k(()=>{let $ODunits=t0(ie,${UNITS_OPTIONS});${UNITS_STACKED},[le,ie,A,Ce,$ODstacked,$ODturn,L,K])`,
  },
  {
    name: 'stacked-view-turn-running',
    find: 'liveTailMaxRows:Lr.activePane?FM:Tre,onStaticEpochReset:Vr,',
    lookups: ['xs=bD(SP),rb=xs!=="idle"'],
    replace: 'liveTailMaxRows:Lr.activePane?FM:Tre,$ODturn:rb,onStaticEpochReset:Vr,',
  },
];
