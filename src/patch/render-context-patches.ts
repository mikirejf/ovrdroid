import type { Patch } from './patches.ts';

const SCHEDULER_INIT =
  'var bQ=Nl(()=>{if(typeof performance==="object"&&typeof performance.now==="function")';

export const renderContextPatches: readonly Patch[] = [
  {
    name: 'render-root-context-snapshot',
    find: SCHEDULER_INIT,
    replace: `var $ODroot=require("async_hooks").AsyncLocalStorage.snapshot();${SCHEDULER_INIT}`,
  },
  {
    name: 'render-root-context-scheduler',
    find: 'RQ=typeof setTimeout==="function"?setTimeout:null,vQ=typeof clearTimeout==="function"?clearTimeout:null,NQ=typeof setImmediate<"u"?setImmediate:null',
    replace:
      'RQ=typeof setTimeout==="function"?($ODcb,$ODms,...$ODargs)=>setTimeout(()=>$ODroot($ODcb,...$ODargs),$ODms):null,' +
      'vQ=typeof clearTimeout==="function"?clearTimeout:null,' +
      'NQ=typeof setImmediate<"u"?($ODcb,...$ODargs)=>setImmediate(()=>$ODroot($ODcb,...$ODargs)):null',
  },
  {
    name: 'render-root-context-host',
    find: 'scheduleMicrotask:queueMicrotask,scheduleTimeout:setTimeout,cancelTimeout:clearTimeout',
    replace:
      'scheduleMicrotask:($ODcb)=>queueMicrotask(()=>$ODroot($ODcb)),' +
      'scheduleTimeout:($ODcb,$ODms,...$ODargs)=>setTimeout(()=>$ODroot($ODcb,...$ODargs),$ODms),' +
      'cancelTimeout:clearTimeout',
  },
];
