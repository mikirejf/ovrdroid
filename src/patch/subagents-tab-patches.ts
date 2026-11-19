import type { Patch } from './patches.ts';

export const SUBAGENT_TAB_ID = 'subagents';

export const SUBAGENT_ROWS =
  'function $ODsubagentRows($ODall,$ODfilter,$ODneedle){' +
  'let $ODkey=($ODid)=>$ODid?$ODid.toLowerCase():"",' +
  '$ODbyId=new Map($ODall.map(($ODs)=>[$ODkey($ODs.id),$ODs])),' +
  '$ODkids=new Map,$ODtops=new Map,$ODattached=new Set,' +
  '$ODnewest=($ODa,$ODb)=>$ODb.modifiedTime.getTime()-$ODa.modifiedTime.getTime(),' +
  '$ODstamp=($ODr)=>($ODkids.get($ODr.id)?.[0]??$ODr).modifiedTime.getTime();' +
  'for(let $ODs of $ODall){if(!$ODfilter($ODs))continue;' +
  'let $ODp=$ODbyId.get($ODkey($ODs.callingSessionId));' +
  'if($ODneedle&&!$ODs.title.toLowerCase().includes($ODneedle)&&!$ODp?.title.toLowerCase().includes($ODneedle))continue;' +
  'if(!$ODp){if(!$ODtops.has($ODs.id))$ODtops.set($ODs.id,$ODs);continue}' +
  '$ODtops.set($ODp.id,{...$ODp,$ODhead:!0});$ODattached.add($ODs.id);' +
  'if(!$ODkids.has($ODp.id))$ODkids.set($ODp.id,[]);$ODkids.get($ODp.id).push($ODs)}' +
  'for(let $ODk of $ODkids.values())$ODk.sort($ODnewest);' +
  'return{listed:[...$ODtops.values()].filter(($ODs)=>!$ODattached.has($ODs.id)).sort(($ODa,$ODb)=>$ODstamp($ODb)-$ODstamp($ODa)),subagentsByCaller:$ODkids,subagentCounts:new Map}}';

const ACTIVE_TAB = 'E1=UEe(we),c1=Ee(we),{listed:_1,subagentsByCaller:P1}=c1';

export const subagentsTabPatches: readonly Patch[] = [
  {
    name: 'subagent-tab-label',
    find: 'favorites:"Favorites",archived:"Archived"}',
    replace: 'favorites:"Favorites",archived:"Archived",subagents:"Subagents"}',
  },
  {
    name: 'subagent-tab-exclude-from-primary-tabs',
    find: 'if(!A2)A2=nqe(g,UEe(S2).filter),T1.set(S2,A2);return A2',
    replace:
      'if(!A2)A2=nqe(S2==="currentFolder"||S2==="all"||S2==="exec"?g.filter(($ODs)=>!$ODs.isSubagent):g,UEe(S2).filter),T1.set(S2,A2);return A2',
  },
  {
    name: 'subagent-tab-def',
    find: 'showPath:!0,filter:Kte}],z2e=',
    replace: `showPath:!0,filter:Kte},{id:"${SUBAGENT_TAB_ID}",labelKey:"sessions.tabs.subagents",showPath:!0,filter:($ODs)=>Boolean($ODs.isSubagent)&&!$ODs.archivedAt}],z2e=`,
  },
  {
    name: 'subagent-tab-rows-fn',
    find: 'function K2e({terminalWidth:g,',
    replace: `${SUBAGENT_ROWS}function K2e({terminalWidth:g,`,
  },
  {
    name: 'subagent-tab-rows',
    find: `${ACTIVE_TAB},q1=Me.trim().toLowerCase(),g2=C((T1)=>!q1||T1.title.toLowerCase().includes(q1),[q1])`,
    lookups: [
      'a2=y(()=>oqe(Y1,c1,(T1,S2)=>p2.has(T1)||T2.has(T1)?S2.filter(G2):[]),[Y1,c1,p2,T2,G2])',
      'e3=y(()=>g.map((T1)=>T1.id).join("\\x00"),[g])',
    ],
    replace: `E1=UEe(we),q1=Me.trim().toLowerCase(),c1=y(()=>we==="${SUBAGENT_TAB_ID}"?$ODsubagentRows(g,E1.filter,q1):Ee(we),[we,g,E1,q1,Ee]),{listed:_1,subagentsByCaller:P1}=c1,g2=C((T1)=>we==="${SUBAGENT_TAB_ID}"||!q1||T1.title.toLowerCase().includes(q1),[we,q1])`,
  },
  {
    name: 'subagent-tab-grey',
    find: 'let{session:S2}=T1,A2=T1===st,Vt=T1===W4||!i2(T1),$2=Re==="archive-confirm"&&t4(T1),Ut={bold:A2,color:$2?O3.color:A2?a.text.primary:a.text.muted,dimColor:Vt}',
    replace:
      'let{session:S2}=T1,A2=T1===st,Vt=T1===W4||!i2(T1),$2=Re==="archive-confirm"&&t4(T1),Ut={bold:A2,color:$2?O3.color:A2?a.text.primary:S2.$ODhead?a.diff.unchanged.dimText:a.text.muted,dimColor:Vt}',
  },
  {
    name: 'subagent-tab-keeps-tree-order',
    find: '{sessions:Y1,forkIndentById:V1}=y(()=>PEe(x2,g),[x2,g])',
    lookups: [ACTIVE_TAB],
    replace: `{sessions:Y1,forkIndentById:V1}=y(()=>we==="${SUBAGENT_TAB_ID}"?{sessions:x2,forkIndentById:new Map}:PEe(x2,g),[we,x2,g])`,
  },
  {
    name: 'subagent-tab-shows-all-matching-branches',
    find: 'a2=y(()=>oqe(Y1,c1,(T1,S2)=>p2.has(T1)||T2.has(T1)?S2.filter(G2):[]),[Y1,c1,p2,T2,G2])',
    lookups: [ACTIVE_TAB],
    replace: `a2=y(()=>oqe(Y1,c1,(T1,S2)=>we==="${SUBAGENT_TAB_ID}"?S2:p2.has(T1)||T2.has(T1)?S2.filter(G2):[]),[we,Y1,c1,p2,T2,G2])`,
  },
  {
    name: 'subagent-tab-fixed-branches',
    find: 'if(st.shownSubagentCount>0)return d2((Vt)=>Vt.delete(S2)),!0;if(st.indent>0&&A2)',
    lookups: ['if(oe(T1,"tab"))return a1(null),ve(Sm1(we)),!0;'],
    replace: `if(st.shownSubagentCount>0&&we!=="${SUBAGENT_TAB_ID}")return d2((Vt)=>Vt.delete(S2)),!0;if(st.indent>0&&A2)`,
  },
  {
    name: 'subagent-tab-no-expand-hint',
    find: 'let J3=!Me&&P1.size>0,c4=Me.trim(),',
    lookups: [ACTIVE_TAB],
    replace: `let J3=we!=="${SUBAGENT_TAB_ID}"&&!Me&&P1.size>0,c4=Me.trim(),`,
  },
  {
    name: 'session-rewind-marker',
    find: `$2=V1.get(Vt.session.id)??0,Ut=Math.min(Math.max($2-1,0),Math.floor(B2/4)),i3=$2>0?\`\${"  ".repeat(Ut)}\\u21B3 \`:"";`,
    replace: `$2=V1.get(Vt.session.id)??0,Ut=Math.min(Math.max($2-1,0),Math.floor(B2/4)),i3=$2>0?\`\${"  ".repeat(Ut)}\${Vt.session.tags.includes("rewind")?"\\u27F2 rewind ":"\\u21B3 "}\`:"";`,
  },
];
