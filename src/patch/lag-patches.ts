import { HEAP_ANCHOR } from './heap-patches.ts';
import type { Patch } from './patches.ts';

export const LAG_VARIABLE = 'OD_LAG';
export const LAG_TICK_MS = 50;
export const LAG_ROW_MS = 1000;

const SAMPLER = `${HEAP_ANCHOR}
globalThis.__odLag??=(()=>{
let $ODfile=process.env.${LAG_VARIABLE};
if(!$ODfile)return 0;
let $ODfs=require("fs"),$ODlates=[],$ODbusy=0,$ODlast=performance.now(),$ODrowStart=$ODlast;
let $ODround=($ODvalue)=>Math.round($ODvalue*10)/10;
setInterval(()=>{
let $ODnow=performance.now(),$ODlate=Math.max(0,$ODnow-$ODlast-${LAG_TICK_MS});
$ODlast=$ODnow;
$ODlates.push($ODlate);
if($ODlate>${LAG_TICK_MS})$ODbusy+=$ODlate;
if($ODnow-$ODrowStart<${LAG_ROW_MS})return;
let $ODsorted=$ODlates.sort(($ODa,$ODb)=>$ODa-$ODb),$ODn=$ODsorted.length;
let $ODrow={t:Date.now(),pid:process.pid,n:$ODn,p50:$ODround($ODsorted[Math.floor($ODn*0.5)]),p99:$ODround($ODsorted[Math.min($ODn-1,Math.floor($ODn*0.99))]),max:$ODround($ODsorted[$ODn-1]),busy:Math.round(Math.min(1,$ODbusy/${LAG_ROW_MS})*1000)/1000};
$ODlates=[];$ODbusy=0;$ODrowStart=$ODnow;
try{$ODfs.appendFileSync($ODfile,JSON.stringify($ODrow)+"\\n")}catch{}
},${LAG_TICK_MS}).unref();
return 1})();
`;

export const lagPatches: readonly Patch[] = [
  {
    name: 'lag-meter',
    find: HEAP_ANCHOR,
    replace: SAMPLER,
  },
];
