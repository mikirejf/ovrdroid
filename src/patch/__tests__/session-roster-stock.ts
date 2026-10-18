export const STOCK_TREE =
  'function S(e,n){n.visited.add(e.sessionId);let t=(n.childrenByParent.get(e.sessionId)??[]).filter((s)=>!n.visited.has(s.sessionId)).map((s)=>S(s,n)).sort(U),o=n.pausedMachines.has(e.machineId)&&!e.starting?{...e,workingState:"idle",queuedCount:0,stopping:!1,prompt:null}:e,r=o.prompt?void 0:t.find((s)=>s.prompt!==null),i=o.prompt??r?.prompt??null,a=e.startFailure||n.unreachableMachines.has(e.machineId)&&!e.starting?"unavailable":i?"needs-attention":yf(o)||t.some((s)=>s.group==="working"||s.group==="needs-attention")?"working":"ready";return{droid:o,group:a,prompt:i,promptFrom:i&&i.sessionId!==e.sessionId?n.titles.get(i.sessionId)??r?.promptFrom??"":null,children:t}}var C=(e,n)=>e.joinOrdinal-n.joinOrdinal;function tA(e,n=new Set,t=new Set){let o=new Set(e.map((d)=>d.sessionId)),r=new Map(e.map((d)=>[d.sessionId,d.title])),i=new Map,a=[];for(let d of[...e].sort(C))if(d.parentSessionId===null)a.push(d);else if(o.has(d.parentSessionId)){let f=i.get(d.parentSessionId)??[];f.push(d),i.set(d.parentSessionId,f)}let s={childrenByParent:i,titles:r,unreachableMachines:n,pausedMachines:t,visited:new Set};return a.map((d)=>S(d,s))}';

export const STOCK_ROW_BUILDER =
  'function un(t,s){return{...t,parentSessionId:null,source:"elsewhere",title:PS(s?.title,t.title)??"",lastActivityAt:Math.max(t.lastActivityAt,s?.lastActivityAt??0),cwd:s?.cwd??t.cwd??"",worktree:null,workingState:s?.workingState??t.workingState,queuedCount:0,prompt:s?s.prompt:t.prompt,preview:s?.preview??t.preview,stopping:!1,starting:!1,startFailure:null,titlePending:!1,firstMessage:"",subagentType:null,pullRequest:s?.pullRequest??t.pullRequest}}';

export const STOCK_ROWS =
  'function Tee({lead:t,agents:s,agentMachineIds:o,live:c,remote:a,previews:l,activityAt:m,machines:f}){let D=ay(f);return[...s].sort((g,w)=>(g.createdAt??0)-(w.createdAt??0)).map((g,w)=>{let y=a.get(g.sessionId),E=un({sessionId:g.sessionId,machineId:o.get(g.sessionId)??t.machineId,joinOrdinal:w+1,title:PS(y?.title,g.title)??"",cwd:g.cwd,lastActivityAt:Math.max(g.updatedAt??g.createdAt??0,m.get(g.sessionId)??0),workingState:y?.workingState??ft(g),prompt:y?hK(y):qe(g),pullRequest:g.pullRequest,preview:l.get(g.sessionId)??Ml,mission:{kind:"agent",missionId:t.sessionId}},c.get(g.sessionId));return mn(E,D,y?pt(y):qe(g)!==null)})}';

export const STOCK_EXPAND =
  'function y1(f){return f.children.length>0||np(f)}function d9(f,y,S,x,w){let I=y1(y)&&w.has(y.droid.sessionId);if(f.push({kind:"droid",id:y.droid.sessionId,node:y,depth:S,parent:x,expanded:I}),!I)return;for(let A of y.children)d9(f,A,S+1,y.droid,w)}';

export const STOCK_SET_TOGGLE =
  'function y2(f,y,S){if(f.has(y)===S)return f;let x=new Set(f);if(S)x.add(y);else x.delete(y);return x}';

export const STOCK_EXPAND_TOGGLE_FN =
  'function ufe(f,y,S){let x=y2(f.expandedDroids,y,S);return x===f.expandedDroids?f:{...f,expandedDroids:x}}';
