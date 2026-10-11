import type { Patch } from './patches.ts';

export const COUNTER_VARIABLE = 'OD_COUNTERS';
export const COUNTER_INTERVAL_MS = 200;

const FIELDS = 'commit:0,build:0,frame:0,frameMs:0,root:0,list:0,md:0,bytes:0';

const INK_START =
  'this.log=(($ODlog,$ODout)=>{' +
  `let $ODstate=globalThis.$ODc;if(!$ODstate){$ODstate=globalThis.$ODc={${FIELDS}};` +
  `if(process.env.${COUNTER_VARIABLE}){` +
  `let $ODfs=require("fs"),$ODfd=$ODfs.openSync(process.env.${COUNTER_VARIABLE},"a");` +
  'let $ODsample=()=>{let $ODcpu=process.cpuUsage();' +
  '$ODfs.writeSync($ODfd,JSON.stringify({t:Date.now(),pid:process.pid,...$ODstate,cpuUser:$ODcpu.user,cpuSystem:$ODcpu.system})+"\\n")};' +
  `$ODsample();setInterval($ODsample,${COUNTER_INTERVAL_MS}).unref();process.on("exit",$ODsample)}}` +
  `if(!process.env.${COUNTER_VARIABLE})return $ODlog;` +
  'let $ODwrite=$ODout.write;' +
  '$ODout.write=function($ODchunk){$ODstate.bytes+=typeof $ODchunk==="string"?Buffer.byteLength($ODchunk):$ODchunk.length;return $ODwrite.apply(this,arguments)};' +
  'return Object.assign(function(){let $ODwrote=$ODlog.apply(this,arguments);if($ODwrote)$ODstate.frame++;return $ODwrote},$ODlog)' +
  '})(vC.create(e.stdout,{incremental:e.incrementalRendering}),e.stdout)';

export const counterPatches: readonly Patch[] = [
  {
    name: 'counter-ink-start',
    find: 'this.log=vC.create(e.stdout,{incremental:e.incrementalRendering})',
    replace: INK_START,
  },
  {
    name: 'counter-commit',
    find: 'resetAfterCommit(e){if(typeof e.onComputeLayout==="function")',
    replace:
      'resetAfterCommit(e){globalThis.$ODc.commit++;if(typeof e.onComputeLayout==="function")',
  },
  {
    name: 'counter-frame-build',
    find: 'this.writeFrame(i);let s=performance.now();',
    lookups: ['onRender=()=>{if(this.hasPendingThrottledRender=!1,this.isUnmounted)return;let e='],
    replace:
      'this.writeFrame(i);let s=performance.now();globalThis.$ODc.build++,globalThis.$ODc.frameMs+=s-e;',
  },
  {
    name: 'counter-root',
    find: 'loginNotice:re}){let le=q?.kind==="local"?q.sessionId:void 0,',
    replace: 'loginNotice:re}){globalThis.$ODc.root++;let le=q?.kind==="local"?q.sessionId:void 0,',
  },
  {
    name: 'counter-message-list',
    find: 'liveTailMaxRows:Z,onStaticEpochReset:Q})=>{let X=B(()=>cye(f,j),[f,j]),',
    replace:
      'liveTailMaxRows:Z,onStaticEpochReset:Q})=>{globalThis.$ODc.list++;let X=B(()=>cye(f,j),[f,j]),',
  },
  {
    name: 'counter-markdown',
    find: '(f){let{completedOffsets:y,dollarPlaceholder:E,',
    replace:
      '(f){globalThis.$ODc&&globalThis.$ODc.md++;let{completedOffsets:y,dollarPlaceholder:E,',
  },
];
