import type { Patch } from './patches.ts';

const APPEND =
  'globalThis.__ofd??=process.env.OD_TRACE?require("fs").openSync(process.env.OD_TRACE,"a"):0,__ofd&&require("fs").writeSync(__ofd,';

const PHASE_LOG = `${APPEND}\`\${process.pid}\\t\${T.phase}\\t\${T.join??""}\\t\${T.startMonoMs.toFixed(1)}\\t\${T.endMonoMs.toFixed(1)}\\n\`);`;

const BOUNDARY_LOG = `${APPEND}\`\${process.pid}\\t\${T.name}\\tboundary\\t\${T.monoMs.toFixed(1)}\\t\${T.monoMs.toFixed(1)}\\n\`);`;

export const tracePatches: readonly Patch[] = [
  {
    name: 'trace-phases',
    find: 'function $1u(T){if(T.endMonoMs===void 0)return;',
    replace: `function $1u(T){if(T.endMonoMs===void 0)return;${PHASE_LOG}`,
  },
  {
    name: 'trace-boundaries',
    find: 'function O1u(T){let R=ir().getRootSpanContext(),H=l1u(T);',
    replace: `function O1u(T){let R=ir().getRootSpanContext(),H=l1u(T);${BOUNDARY_LOG}`,
  },
];

const CHARGE =
  'function __oe(k,f,s){let d=performance.now()-s,c=__os.pop();__ot[k]=(__ot[k]||0)+(d-c);if(__os.length)__os[__os.length-1]+=d;if(d-c>1&&!__on[k])__on[k]=f}';

const LABEL =
  'function __ol(f){if(!f)return"";try{return String(f).slice(0,140).replace(/[\\t\\n]/g," ")}catch{return"?"}}';

const DUMP = `process.env.OD_MODULES&&setTimeout(()=>require("fs").writeFileSync(process.env.OD_MODULES,__ot.map((v,i)=>\`\${v.toFixed(2)}\\t\${__ol(__on[i])}\\n\`).join("")),0),`;

export const modulePatches: readonly Patch[] = [
  {
    name: 'module-timing-cjs',
    find: 'var yT=(T,R)=>()=>(R||T((R={exports:{}}).exports,R),R.exports);',
    replace: `var __oi=0,__ot=[],__on=[],__os=[];${CHARGE}${LABEL}var yT=(T,R,K=__oi++)=>()=>{if(!R){let f=T,s=performance.now();__os.push(0);try{T((R={exports:{}}).exports,R)}finally{__oe(K,f,s)}}return R.exports};`,
  },
  {
    name: 'module-timing-esm',
    find: 'var o=(T,R)=>()=>(T&&(R=T(T=0)),R);',
    replace:
      'var o=(T,R,K=__oi++)=>()=>{if(T){let f=T,s=performance.now();__os.push(0);try{R=T(T=0)}finally{__oe(K,f,s)}}return R};',
  },
  {
    name: 'module-timing-dump',
    find: 'ClT("input_mounted")',
    replace: `(${DUMP}ClT("input_mounted"))`,
  },
];
