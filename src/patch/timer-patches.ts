import type { Patch } from './patches.ts';

export const TIMER_VARIABLE = 'OD_TIMERS';

const HEADER = '// @bun @bytecode';

const WRAP = `${HEADER}
globalThis.__otw??=((F)=>{
let fd=process.env.${TIMER_VARIABLE}?F.openSync(process.env.${TIMER_VARIABLE},"a"):0;
let site=(f)=>{try{return String(f).slice(0,120).replace(/[\\t\\n]/g," ")}catch{return"?"}};
let log=(m)=>{if(fd)F.writeSync(fd,performance.now().toFixed(0)+"\\t"+process.pid+"\\t"+m+"\\n")};
let wrap=(kind,original)=>function(fn,ms,...rest){
let where=site(fn),fired=0;
let seen=typeof fn==="function"?function(...args){fired++;log("fire\\t"+kind+"\\t"+ms+"\\t"+where);return fn.apply(this,args)}:fn;
log("arm\\t"+kind+"\\t"+ms+"\\t"+where);
return original.call(this,seen,ms,...rest)};
globalThis.setInterval=wrap("interval",globalThis.setInterval);
globalThis.setTimeout=wrap("timeout",globalThis.setTimeout);
return log})(require("fs"));
`;

export const timerPatches: readonly Patch[] = [
  {
    name: 'timer-census',
    find: HEADER,
    replace: WRAP,
  },
];
