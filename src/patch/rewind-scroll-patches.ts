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

const HOOK_START = 'function zp1(g){let{maxRows:y,onOpen:E,onExit:A}=g,';

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
  'J5(()=>{i1.current=(l1)=>{let c1=V.current;if(!c1)return;if(l1.effect==="exit"){o1();return}';

const SEEK_STEP =
  'if(c1.odTarget!==void 0&&l1.window){let $ODw=$ODseekWindow(l1.window,c1,Z.current);' +
  'if($ODw===void 0){r1(),t1({sessionId:c1.sessionId,openingUnit:"page",odTarget:c1.odTarget,odTops:{}}),' +
  's1({index:0,cursor:void 0});return}l1={...l1,window:$ODw}}';

const HOOK_LOOKUPS = [
  'r1=C(()=>{q.current+=1,K.current.clear(),t1(void 0)},[t1])',
  'E(),r1(),t1({sessionId:f1,openingUnit:c1}),s1({index:0,cursor:void 0});return}',
  'J5(()=>{Z.current=y},[y]);',
];

const LOAD_FAILED =
  'r("[TranscriptHistory] Failed to load transcript page",{cause:x1});let T1=V.current;if(!T1)return;';

const RECORD_AND_RETURN =
  'd1=C((l1,c1,f1,h1)=>{let y1=V.current;if(!y1?.window)return;' +
  'let x1=vu1(y1.window,{[l1]:c1},Z.current,{[l1]:f1},{[l1]:h1});i1.current({window:x1,effect:"none"}),u1()},[u1]);' +
  'return{transcriptHistory:D,pageTranscriptHistory:a1,resetTranscriptHistory:r1,exitTranscriptHistory:o1,' +
  'recordTranscriptHistoryPageHeight:d1}}';

const SEEK_API =
  'd1=C((l1,c1,f1,h1,$ODtops)=>{let y1=V.current;if(!y1?.window)return;' +
  'if(y1.odTops&&$ODtops)y1.odTops[l1]=$ODtops;' +
  'let x1=vu1(y1.window,{[l1]:c1},Z.current,{[l1]:f1},{[l1]:h1});i1.current({window:x1,effect:"none"}),u1()},[u1]),' +
  '$ODseekTo=C(($ODid,$ODnewer)=>{let f1=m().getCurrentSessionId();if(!f1)return;let h1=V.current;' +
  'if(!h1||h1.sessionId!==f1||!h1.odTops){E(),r1(),t1({sessionId:f1,openingUnit:"page",odTarget:$ODid,odTops:{}}),' +
  's1({index:0,cursor:void 0});return}' +
  't1({...h1,odTarget:$ODid,odNewer:$ODnewer});if(h1.window)i1.current({window:h1.window,effect:"none"})},[E,r1,t1,s1]);' +
  'U(()=>{let c1=V.current;if(c1?.odTarget!==void 0&&c1.window)i1.current({window:c1.window,effect:"none"})},[y]);' +
  'return{transcriptHistory:D,pageTranscriptHistory:a1,resetTranscriptHistory:r1,exitTranscriptHistory:o1,' +
  'recordTranscriptHistoryPageHeight:d1,odSeekTranscriptHistory:$ODseekTo}}';

const APP_HOOK = 'recordTranscriptHistoryPageHeight:ty1}=zp1({maxRows:bj,onOpen:l2,onExit:Gt});';

const APP_EXIT_LOOKUP = 'exitTranscriptHistory:iu,recordTranscriptHistoryPageHeight:ty1}=zp1(';

const MENU_CONTEXT = 'onRewindSelect:(b1)=>{Gy(b1)},';

const MENU_CONTEXT_DEPS = 'onIdeInstanceDisconnect:Cq}),[Gt,R2,uV,Gy,PV,';

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

const SEGMENT_REF_LOOKUP = 'let q=S(null),K=S(new Map),X=$U(B)';

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
    find: RECORD_AND_RETURN,
    lookups: [
      ...HOOK_LOOKUPS,
      'let f1=m().getCurrentSessionId();if(!f1)return;let h1=V.current;',
      'U(()=>{rw(B,Z)},[B,Z])',
    ],
    replace: SEEK_API,
  },
  {
    name: 'app-takes-transcript-history-seek',
    find: APP_HOOK,
    replace: APP_HOOK.replace('ty1}=', 'ty1,odSeekTranscriptHistory:$ODseekHistory}='),
  },
  {
    name: 'rewind-menu-context-seeks-history',
    find: MENU_CONTEXT,
    lookups: [APP_EXIT_LOOKUP],
    replace: `${MENU_CONTEXT}odRewindSeek:$ODseekHistory,odRewindEnd:iu,`,
  },
  {
    name: 'rewind-menu-context-seek-deps',
    find: MENU_CONTEXT_DEPS,
    lookups: [APP_EXIT_LOOKUP],
    replace: `${MENU_CONTEXT_DEPS}$ODseekHistory,iu,`,
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
