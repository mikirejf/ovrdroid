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
    find: 'resetAfterCommit(e){let i=',
    replace: 'resetAfterCommit(e){globalThis.$ODc.commit++;let i=',
  },
  {
    name: 'counter-frame-build',
    find: 'this.renderFrame(i,l,r);let Q=performance.now();',
    lookups: [
      'if(this.lastOutputHeight===0&&this.lastOutput!==""&&!this.isUnmounting)this.lastOutputToRender="";let e=performance.now(),',
    ],
    replace:
      'this.renderFrame(i,l,r);let Q=performance.now();globalThis.$ODc.build++,globalThis.$ODc.frameMs+=Q-e;',
  },
  {
    name: 'counter-root',
    find: 'onLoggedOut:ie,loginNotice:re}){',
    replace: 'onLoggedOut:ie,loginNotice:re}){globalThis.$ODc.root++;',
  },
  {
    name: 'counter-message-list',
    find: 'onStaticEpochReset:Y,activeMachineId:ee,activeMachineName:te})=>{',
    replace:
      'onStaticEpochReset:Y,activeMachineId:ee,activeMachineName:te})=>{globalThis.$ODc.list++;',
  },
  {
    name: 'counter-markdown',
    find: '(f){let{completedOffsets:y,dollarPlaceholder:E,',
    replace:
      '(f){globalThis.$ODc&&globalThis.$ODc.md++;let{completedOffsets:y,dollarPlaceholder:E,',
  },
];
