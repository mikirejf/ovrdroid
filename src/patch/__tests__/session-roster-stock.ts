export const STOCK_TREE =
  'function b(e,t){t.visited.add(e.sessionId);let n=(t.childrenByParent.get(e.sessionId)??[]).filter((u)=>!t.visited.has(u.sessionId)).map((u)=>b(u,t)).sort(ce),o=t.pausedMachines.has(e.machineId)&&!e.starting&&e.prompt===null?{...e,workingState:"idle",queuedCount:0,stopping:!1}:e,r=o.prompt?void 0:n.find((u)=>u.prompt!==null),s=o.prompt??r?.prompt??null,l=e.startFailure||t.unreachableMachines.has(e.machineId)&&!e.starting?"unavailable":s?"needs-attention":f9(o)||n.some((u)=>u.group==="working"||u.group==="needs-attention")?"working":"ready";return{droid:o,group:l,prompt:s,promptFrom:s&&s.sessionId!==e.sessionId?t.titles.get(s.sessionId)??r?.promptFrom??"":null,children:n}}var pe=(e,t)=>e.joinOrdinal-t.joinOrdinal;function u_(e,t=new Set,n=new Set){let o=new Set(e.map((a)=>a.sessionId)),r=new Map(e.map((a)=>[a.sessionId,a.title])),s=new Map,l=[];for(let a of[...e].sort(pe))if(a.parentSessionId===null)l.push(a);else if(o.has(a.parentSessionId)){let d=s.get(a.parentSessionId)??[];d.push(a),s.set(a.parentSessionId,d)}let u={childrenByParent:s,titles:r,unreachableMachines:t,pausedMachines:n,visited:new Set};return l.map((a)=>b(a,u))}';

export const STOCK_ROW_BUILDER =
  'function Dn(t,o){return o?[...t,...o.pullRequestArtifacts]:t}function wn({pullRequestArtifacts:t,...o},s){return{...o,parentSessionId:null,source:"elsewhere",title:Cb(s?.title,o.title)??"",lastActivityAt:Math.max(o.lastActivityAt,s?.lastActivityAt??0),cwd:s?.cwd??o.cwd??"",worktree:null,workingState:s?.workingState??o.workingState,queuedCount:0,prompt:s?s.prompt:o.prompt,preview:s?.preview??o.preview,stopping:!1,starting:!1,startFailure:null,titlePending:!1,firstMessage:"",subagentType:null,pullRequest:l_(t)}}function Ye(t){return t.promptKind!==null||t.workingState==="waiting_for_tool_confirmation"}function In(t,o,s){return o.has(t.machineId)&&!s?{...t,workingState:"idle",prompt:null}:t}';

export const STOCK_ROWS =
  'function Mn({lead:t,agents:o,agentMachineIds:s,live:c,remote:a,previews:d,activityAt:l,machines:u}){let p=k9(u);return[...o].sort((f,y)=>(f.createdAt??0)-(y.createdAt??0)).map((f,y)=>{let g=a.get(f.sessionId),M=c.get(f.sessionId),I=Dn(f.pullRequestArtifacts,M),b=wn({sessionId:f.sessionId,machineId:s.get(f.sessionId)??t.machineId,joinOrdinal:y+1,title:Cb(g?.title,f.title)??"",cwd:f.cwd,lastActivityAt:Math.max(f.updatedAt??f.createdAt??0,l.get(f.sessionId)??0),workingState:g?.workingState??ze(f),prompt:g?OQ(g):Pe(f),pullRequestArtifacts:I,preview:d.get(f.sessionId)??bT,mission:{kind:"agent",missionId:t.sessionId}},M);return{droid:In(b,p,g?Ye(g):Pe(f)!==null),pullRequestArtifacts:I}})}function qQ(t){return Mn(t).map(({droid:o})=>o)}';

export const STOCK_EXPAND =
  'function nn(t){return t.children.length>0||mb(t)}function on(t,o,s,c,a,d){let l=nn(o)&&d.has(o.droid.sessionId);if(t.push({kind:"droid",id:o.droid.sessionId,node:o,depth:s,parent:c,kindWidth:a,expanded:l}),!l)return;let u=Math.min(o.children.reduce((p,S)=>Math.max(p,X(goe(S.droid))),0),Ht);for(let p of o.children)on(t,p,s+1,o.droid,u,d)}';

export const STOCK_SET_TOGGLE =
  'function y2(f,y,S){if(f.has(y)===S)return f;let x=new Set(f);if(S)x.add(y);else x.delete(y);return x}';

export const STOCK_EXPAND_TOGGLE_FN =
  'function ufe(f,y,S){let x=y2(f.expandedDroids,y,S);return x===f.expandedDroids?f:{...f,expandedDroids:x}}';
