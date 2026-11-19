import type { Patch } from './patches.ts';

const UNIT_REF = 'K.current.set(e1.unitId,{node:o1,isUser:r1})';

const PAGE_MEASURE =
  'r1=[],o1=[];for(let i1 of K.current.values()){let s1=i1.node.yogaNode;if(!s1)continue;' +
  'let a1=t1-s1.getComputedTop()-s1.getComputedHeight();if(o1.push(a1),i1.isUser)r1.push(a1)}' +
  'V(g.index,t1,r1.toSorted((i1,s1)=>i1-s1),o1.toSorted((i1,s1)=>i1-s1))}';

const PAGE_MEASURE_WITH_TOPS =
  'r1=[],o1=[],$ODtops={};for(let i1 of K.current.values()){let s1=i1.node.yogaNode;if(!s1)continue;' +
  'let a1=t1-s1.getComputedTop()-s1.getComputedHeight();if(o1.push(a1),i1.isUser)r1.push(a1),' +
  '$ODtops[i1.odMessageId]=Math.max($ODtops[i1.odMessageId]??0,t1-s1.getComputedTop())}' +
  'V(g.index,t1,r1.toSorted((i1,s1)=>i1-s1),o1.toSorted((i1,s1)=>i1-s1),$ODtops)}';

const HOOK_START = 'function qve(g){let{onOpen:k,onExit:A}=g,[P,B]=_(),F=g.maxRows(P?.error),';

export const SEEK_WINDOW =
  'function $ODseekWindow($ODw,$ODs,$ODrows){' +
  'let $ODbase=($ODi)=>{let $ODn=0;for(let $ODk=0;$ODk<$ODi;$ODk++){let $ODh=$ODw.pageHeights[$ODk];' +
  'if($ODh===void 0)return;$ODn+=$ODh}return $ODn};' +
  'for(let $ODp of $ODw.pages){let $ODtop=$ODs.odTops[$ODp.index]?.[$ODs.odTarget],$ODb=$ODbase($ODp.index);' +
  'if($ODtop!==void 0&&$ODb!==void 0)' +
  'return{...$ODw,rowsFromEnd:Math.max(0,$ODb+$ODtop-$ODrows),olderStepStarts:[],pendingStep:void 0}}' +
  'let $ODlast=$ODw.pages.at(-1),$ODend=$ODlast&&$ODbase($ODlast.index+1);' +
  'if($ODend===void 0)return $ODw;' +
  'if($ODs.odNewer&&$ODw.firstPageIndex>0)return;' +
  'if(!$ODw.prefetched&&!$ODlast.hasMore)return $ODw;' +
  'let $ODr=Math.max($ODw.rowsFromEnd,$ODend-$ODrows);' +
  'return $ODw.prefetched?{...$ODw,pages:[...$ODw.pages,$ODw.prefetched],prefetched:void 0,rowsFromEnd:$ODr}' +
  ':{...$ODw,rowsFromEnd:$ODr}}';

const APPLY_STEP =
  'd7(()=>{ce.current=(be)=>{let we=H.current;if(!we)return;if(be.effect==="exit"){ie();return}';

const SEEK_STEP =
  'if(we.odTarget!==void 0&&be.window){let $ODw=$ODseekWindow(be.window,we,Z.current);' +
  'if($ODw===void 0){re(),ne({sessionId:we.sessionId,openingUnit:"page",odTarget:we.odTarget,odTops:{}}),' +
  'ue({index:0,cursor:void 0});return}be={...be,window:$ODw}}';

const HOOK_LOOKUPS = [
  're=C(()=>{q.current+=1,X.current.clear(),ne(void 0)},[ne])',
  'k(),re(),ne({sessionId:Me,openingUnit:we}),ue({index:0,cursor:void 0});return}',
  'd7(()=>{Z.current=F},[F]);',
];

const LOAD_FAILED =
  'r("[TranscriptHistory] Failed to load transcript page",{cause:x1});let T1=V.current;if(!T1)return;';

const RECORD_HEIGHT =
  'Ee=C((be,we,Me,Ae)=>{let Re=H.current;if(!Re?.window)return;' +
  'let Ie=hye(Re.window,{[be]:we},Z.current,{[be]:Me},{[be]:Ae});' +
  'ce.current({window:Ie,effect:"none"}),ve()},[ve])';

const HOOK_RETURN =
  'return{transcriptHistory:P,pageTranscriptHistory:Le,resetTranscriptHistory:re,exitTranscriptHistory:ie,' +
  'recordTranscriptHistoryPageHeight:Ee,maxRows:F';

const SEEK_API =
  `${RECORD_HEIGHT.replace('(be,we,Me,Ae)', '(be,we,Me,Ae,$ODtops)').replace(
    'if(!Re?.window)return;',
    'if(!Re?.window)return;if(Re.odTops&&$ODtops)Re.odTops[be]=$ODtops;',
  )},` +
  '$ODseekTo=C(($ODid,$ODnewer)=>{let $ODsessionId=m().getCurrentSessionId();if(!$ODsessionId)return;' +
  'let $ODstate=H.current;if(!$ODstate||$ODstate.sessionId!==$ODsessionId||!$ODstate.odTops){' +
  'k(),re(),ne({sessionId:$ODsessionId,openingUnit:"page",odTarget:$ODid,odTops:{}}),' +
  'ue({index:0,cursor:void 0});return}' +
  'ne({...$ODstate,odTarget:$ODid,odNewer:$ODnewer});' +
  'if($ODstate.window)ce.current({window:$ODstate.window,effect:"none"})},[k,re,ne,ue]);' +
  'U(()=>{let $ODstate=H.current;if($ODstate?.odTarget!==void 0&&$ODstate.window)' +
  'ce.current({window:$ODstate.window,effect:"none"})},[F]);' +
  `${HOOK_RETURN},odSeekTranscriptHistory:$ODseekTo}}`;

const APP_HOOK = 'exitTranscriptHistory:Zu,recordTranscriptHistoryPageHeight:nRe,maxRows:rRe}=qve(';

const MENU_CONTEXT = 'onRewindSelect:(He)=>{Sb(He)},';

const MENU_CONTEXT_DEPS = 'onFolderTrustSettle:vK}),[';

const MENU_PANE = 'onSelect:(B)=>{A.onRewindSelect(B),E()},onCancel:E})';

const MENU =
  'function ag1({options:g,onSelect:y,onCancel:E,paneHeight:A}){let{t:D}=Y(),[B,V]=_(0),' +
  'q=A===void 0?ox:Math.max(1,Math.min(ox,A-Yw)),{selectedIndex:K}=pe({rows:g,rowKey:(t1)=>t1.messageId,' +
  'anchorKey:g[0]?.messageId??null,wrapAround:!0,onSelect:(t1)=>{if(g.length>0)y(t1)},onCancel:E});' +
  'U(()=>{if(K<B)V(K);else if(K>=B+q)V(K-q+1)},[K,B,q]);';

const MENU_FOLLOWS =
  'function ag1({options:g,onSelect:y,onCancel:E,paneHeight:A,odOnSeek:$ODonSeek,odOnEnd:$ODonEnd}){let{t:D}=Y(),[B,V]=_(0),' +
  'q=A===void 0?ox:Math.max(1,Math.min(ox,A-Yw)),{selectedIndex:K}=pe({rows:g,rowKey:(t1)=>t1.messageId,' +
  'anchorKey:g[0]?.messageId??null,wrapAround:!0,onSelect:(t1)=>{if(g.length>0)y(t1)},onCancel:E}),' +
  '$ODshown=S(K),$ODend=S($ODonEnd);$ODend.current=$ODonEnd;' +
  'U(()=>{if(K<B)V(K);else if(K>=B+q)V(K-q+1)},[K,B,q]);' +
  'U(()=>{let $ODprev=$ODshown.current,$ODrow=g[K];if($ODprev===K||!$ODrow)return;' +
  '$ODshown.current=K,$ODonSeek?.($ODrow.messageId,K<$ODprev)},[K,g,$ODonSeek]);' +
  'U(()=>()=>{$ODend.current?.()},[]);';

const SEGMENT_REF_LOOKUP = 'onPageHeight:p2})=>{let h2=S(null),j2=S(new Map),';

const STATE_UNCHANGED = 'c1.error===l1.error&&Tu1(c1.window,l1.window,Z.current))return;';

const SEGMENT_PROPS = '({page:g,isMeasured:y,contentWidth:E,toolOutputMode:A,';

const SEGMENT_DRAW =
  'children:Z.map((e1)=>{let t1=T8(e1,{contentWidth:E,showThinking:D,compact:A!=="expanded",renderRegion:"dynamic"});';

export const FOCUS_UNIT =
  '$ODfocus!==void 0&&e1.kind==="item"&&e1.item.id===$ODfocus?{...e1,item:{...e1.item,$ODfocus:!0}}:e1';

const USER_MESSAGE =
  'if(l1&&!d1){let c1=g.interactionMode==="spec"?a.spec:a.text.userSymbol;' +
  'return t(s,{flexDirection:"column",width:"100%",children:c(s,{flexDirection:"row",width:"100%",children:[' +
  't(s,{backgroundColor:c1,flexShrink:0,children:t(o,{backgroundColor:c1,children:" "})}),' +
  'c(s,{flexDirection:"column",paddingLeft:2,backgroundColor:a.text.userBg,flexGrow:1,children:[' +
  'c(o,{wrap:"wrap",color:a.text.userText,backgroundColor:a.text.userBg,children:[typeof u1==="string"?t(Qv,{text:u1}):u1," "]})';

const FOCUS_COLOR = 'g.$ODfocus===!0?a.primary:';

export const rewindScrollPatches: readonly Patch[] = [
  {
    name: 'transcript-history-unit-knows-its-message',
    find: UNIT_REF,
    replace: 'K.current.set(e1.unitId,{node:o1,isUser:r1,odMessageId:r1?e1.item.id:void 0})',
  },
  {
    name: 'transcript-history-page-reports-message-tops',
    find: PAGE_MEASURE,
    replace: PAGE_MEASURE_WITH_TOPS,
  },
  {
    name: 'transcript-history-seek-window',
    find: HOOK_START,
    replace: `${SEEK_WINDOW}${HOOK_START}`,
  },
  {
    name: 'transcript-history-follows-seek-target',
    find: APPLY_STEP,
    lookups: HOOK_LOOKUPS,
    replace: `${APPLY_STEP}${SEEK_STEP}`,
  },
  {
    name: 'transcript-history-seek-leaves-on-load-error',
    find: LOAD_FAILED,
    lookups: ['o1=C(()=>{if(!V.current)return;A(),r1()},[A,r1])'],
    replace: `${LOAD_FAILED}if(T1.odTops&&!T1.window){o1();return}`,
  },
  {
    name: 'transcript-history-seek-api',
    find: `${RECORD_HEIGHT};${HOOK_RETURN}}}`,
    lookups: [
      ...HOOK_LOOKUPS,
      'let Me=m().getCurrentSessionId();if(!Me)return;let Ae=H.current;',
      'U(()=>{Jw(g,"ActiveWorkerPreview")},[g]);',
    ],
    replace: SEEK_API,
  },
  {
    name: 'app-takes-transcript-history-seek',
    find: APP_HOOK,
    replace: APP_HOOK.replace('}=', ',odSeekTranscriptHistory:$ODseekHistory}='),
  },
  {
    name: 'rewind-menu-context-seeks-history',
    find: MENU_CONTEXT,
    lookups: [APP_HOOK],
    replace: `${MENU_CONTEXT}odRewindSeek:$ODseekHistory,odRewindEnd:Zu,`,
  },
  {
    name: 'rewind-menu-context-seek-deps',
    find: MENU_CONTEXT_DEPS,
    lookups: [APP_HOOK],
    replace: `${MENU_CONTEXT_DEPS}$ODseekHistory,Zu,`,
  },
  {
    name: 'rewind-pane-leaves-history',
    find: MENU_PANE,
    replace:
      'odOnSeek:A.odRewindSeek,odOnEnd:A.odRewindEnd,' +
      'onSelect:(B)=>{A.odRewindEnd?.(),A.onRewindSelect(B),E()},onCancel:()=>{A.odRewindEnd?.(),E()}})',
  },
  {
    name: 'rewind-menu-moves-history',
    find: MENU,
    lookups: [SEGMENT_REF_LOOKUP],
    replace: MENU_FOLLOWS,
  },
  {
    name: 'transcript-history-state-tracks-seek-target',
    find: STATE_UNCHANGED,
    replace: STATE_UNCHANGED.replace('&&Tu1(', '&&c1.odTarget===l1.odTarget&&Tu1('),
  },
  {
    name: 'app-passes-rewind-focus',
    find: 't(vU,{historyWindow:qn.window,',
    replace: 't(vU,{historyWindow:qn.window,odFocus:qn.odTarget,',
  },
  {
    name: 'transcript-history-panel-takes-focus',
    find: '({historyWindow:g,contentWidth:y,maxRows:E,',
    replace: '({historyWindow:g,odFocus:$ODfocus,contentWidth:y,maxRows:E,',
  },
  {
    name: 'transcript-history-page-gets-focus',
    find: 't(wu1,{page:a1,',
    replace: 't(wu1,{page:a1,odFocus:$ODfocus,',
  },
  {
    name: 'transcript-history-segment-takes-focus',
    find: SEGMENT_PROPS,
    replace: SEGMENT_PROPS.replace('page:g,', 'page:g,odFocus:$ODfocus,'),
  },
  {
    name: 'transcript-history-segment-marks-focus',
    find: SEGMENT_DRAW,
    replace: SEGMENT_DRAW.replace('T8(e1,', `T8(${FOCUS_UNIT},`),
  },
  {
    name: 'user-message-focus-color',
    find: USER_MESSAGE,
    replace: USER_MESSAGE.replace('let c1=', `let c1=${FOCUS_COLOR}`).replace(
      'color:a.text.userText',
      `color:${FOCUS_COLOR}a.text.userText`,
    ),
  },
];
