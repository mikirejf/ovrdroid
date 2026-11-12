import type { Patch } from './patches.ts';

export const SUBAGENT_TAB_ID = 'subagents';

export const SUBAGENT_ROWS =
  'function $ODsubagentRows($ODshown,$ODall,$ODneedle){' +
  'let $ODkey=($ODid)=>$ODid?$ODid.toLowerCase():"",' +
  '$ODbyId=new Map($ODall.map(($ODs)=>[$ODkey($ODs.id),$ODs])),' +
  '$ODparent=($ODs)=>$ODbyId.get($ODkey($ODs.callingSessionId)),' +
  '$ODkids=new Map,$ODheads=new Map,$ODtops=[],$ODout=[],' +
  '$ODnewest=($ODa,$ODb)=>$ODb.modifiedTime.getTime()-$ODa.modifiedTime.getTime(),' +
  '$ODstamp=($ODr)=>Math.max(...($ODkids.get($ODr.id)??[]).map(($ODs)=>$ODs.modifiedTime.getTime()),$ODr.$ODhead?0:$ODr.modifiedTime.getTime());' +
  'for(let $ODs of $ODshown){let $ODp=$ODparent($ODs);' +
  'if($ODneedle&&!$ODs.title.toLowerCase().includes($ODneedle)&&!$ODp?.title.toLowerCase().includes($ODneedle))continue;' +
  'if(!$ODp){$ODtops.push({row:$ODs});continue}' +
  '$ODheads.set($ODp.id,$ODp);' +
  'if(!$ODkids.has($ODp.id))$ODkids.set($ODp.id,[]);$ODkids.get($ODp.id).push($ODs)}' +
  'for(let $ODp of $ODheads.values())$ODtops.push({row:{...$ODp,$ODhead:!0}});' +
  'for(let $ODt of $ODtops)$ODt.stamp=$ODstamp($ODt.row);' +
  '$ODtops.sort(($ODa,$ODb)=>$ODb.stamp-$ODa.stamp);' +
  'for(let $ODt of $ODtops){$ODout.push($ODt.row);' +
  'let $ODk=($ODkids.get($ODt.row.id)??[]).sort($ODnewest);' +
  '$ODk.forEach(($ODs,$ODi)=>$ODout.push({...$ODs,$ODprefix:$ODi===$ODk.length-1?"  \\u2514 ":"  \\u251C "}))}' +
  'return $ODout}';

export const subagentsTabPatches: readonly Patch[] = [
  {
    name: 'subagent-parent-column',
    find: 'i.settings_mtime_ms AS settings_mtime_ms`',
    replace:
      'i.settings_mtime_ms AS settings_mtime_ms,sessions.calling_session_id AS calling_session_id`',
  },
  {
    name: 'subagent-parent-row',
    find: 'settingsMtimeMs:l,messagesCount:oe(o,"messages_count")}}function pd(',
    lookups: ['cwd:ee(o,"cwd"),title:ee(o,"title")'],
    replace:
      'settingsMtimeMs:l,messagesCount:oe(o,"messages_count"),callingSessionId:ee(o,"calling_session_id")}}function pd(',
  },
  {
    name: 'subagent-parent-item',
    find: '...t.tags.includes(Ho)?{isSubagent:!0}:{},',
    replace:
      '...t.tags.includes(Ho)?{isSubagent:!0}:{},...t.callingSessionId?{callingSessionId:t.callingSessionId}:{},',
  },
  {
    name: 'subagent-tab-label',
    find: 'favorites:"Favorites",archived:"Archived"}',
    replace: 'favorites:"Favorites",archived:"Archived",subagents:"Subagents"}',
  },
  {
    name: 'subagent-tab-current-folder',
    find: 'zte=(g)=>Boolean(g.isCurrentProject)&&!g.isExec&&!g.archivedAt,',
    replace: 'zte=(g)=>Boolean(g.isCurrentProject)&&!g.isExec&&!g.archivedAt&&!g.isSubagent,',
  },
  {
    name: 'subagent-tab-all',
    find: 'filter:(g)=>!g.isExec&&!g.archivedAt}',
    replace: 'filter:(g)=>!g.isExec&&!g.archivedAt&&!g.isSubagent}',
  },
  {
    name: 'subagent-tab-exec',
    find: 'filter:(g)=>Boolean(g.isExec)&&!g.archivedAt}',
    replace: 'filter:(g)=>Boolean(g.isExec)&&!g.archivedAt&&!g.isSubagent}',
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
    find: 'tn=k(()=>{let In=be.trim().toLowerCase();if(!In)return mn;return mn.filter((io)=>io.title.toLowerCase().includes(In))},[mn,be])',
    lookups: ['rn=T0.find((In)=>In.id===Se)??T0[0],mn=k(()=>g.filter(rn.filter),[g,rn])'],
    replace: `tn=k(()=>{let In=be.trim().toLowerCase();if(rn.id==="${SUBAGENT_TAB_ID}")return $ODsubagentRows(mn,g,In);if(!In)return mn;return mn.filter((io)=>io.title.toLowerCase().includes(In))},[mn,be,rn,g])`,
  },
  {
    name: 'subagent-tab-grey',
    find: 'co=Dn?En.color:Xt?a.text.primary:a.text.muted,go=In.id===y',
    replace:
      'co=Dn?En.color:Xt?a.text.primary:In.$ODhead?a.diff.unchanged.dimText:a.text.muted,go=In.id===y',
  },
  {
    name: 'subagent-tab-keeps-tree-order',
    find: '{sessions:J1,forkIndentById:a2}=y(()=>Lu1(L2,g),[L2,g])',
    lookups: ['l2=zd.find((Y1)=>Y1.id===C1)??zd[0],u2=y(()=>g.filter(l2.filter),[g,l2])'],
    replace: `{sessions:J1,forkIndentById:a2}=y(()=>l2.id==="${SUBAGENT_TAB_ID}"?{sessions:L2,forkIndentById:new Map}:Lu1(L2,g),[L2,g,l2])`,
  },
  {
    name: 'subagent-tab-prefix',
    find: 'children:[H3,s3?c(i,{color:a.text.muted,children:[s3," "]}):null,Y1.title?',
    replace:
      'children:[H3,Y1.$ODprefix?c(i,{color:a.text.muted,children:[Y1.$ODprefix]}):null,s3?c(i,{color:a.text.muted,children:[s3," "]}):null,Y1.title?',
  },
];
