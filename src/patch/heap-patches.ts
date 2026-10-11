import type { Patch } from './patches.ts';

export const HEAP_VARIABLE = 'OD_HEAP';
export const HEAP_INTERVAL_VARIABLE = 'OD_HEAP_MS';
export const HEAP_TYPES_VARIABLE = 'OD_HEAP_TYPES_EVERY';
export const HEAP_SNAPSHOT_SIGNAL = 'SIGUSR1';
export const HEAP_ANCHOR = 'FACTORY_E2E_DISK_FAULT_FILE;';
const DEFAULT_INTERVAL_MS = 500;
const DEFAULT_TYPES_EVERY = 10;
const TOP_TYPES = 25;

const SAMPLER = `${HEAP_ANCHOR}
globalThis.__odHeap??=(()=>{
let $ODfile=process.env.${HEAP_VARIABLE};
if(!$ODfile)return 0;
let $ODfs=require("fs"),$ODjsc=require("bun:jsc"),$ODtick=0,$ODsnaps=0;
let $ODms=Number(process.env.${HEAP_INTERVAL_VARIABLE})||${DEFAULT_INTERVAL_MS};
let $ODevery=Number(process.env.${HEAP_TYPES_VARIABLE})||${DEFAULT_TYPES_EVERY};
let $ODput=($ODrow)=>{try{$ODfs.appendFileSync($ODfile,JSON.stringify($ODrow)+"\\n")}catch{}};
let $ODbiggest=($ODcounts)=>Object.fromEntries(Object.entries($ODcounts).sort(($ODa,$ODb)=>$ODb[1]-$ODa[1]).slice(0,${TOP_TYPES}));
let $ODsample=()=>{try{
let $ODstart=performance.now(),$ODmem=process.memoryUsage();
let $ODrow={t:Date.now(),pid:process.pid,rss:$ODmem.rss,heapUsed:$ODmem.heapUsed,heapTotal:$ODmem.heapTotal,external:$ODmem.external,arrayBuffers:$ODmem.arrayBuffers};
if($ODtick++%$ODevery===0){
let $ODstats=$ODjsc.heapStats();
$ODrow.jscHeap=$ODstats.heapSize;$ODrow.jscCapacity=$ODstats.heapCapacity;$ODrow.jscExtra=$ODstats.extraMemorySize;$ODrow.objects=$ODstats.objectCount;
$ODrow.top=$ODbiggest($ODstats.objectTypeCounts)}
else $ODrow.jscHeap=$ODjsc.heapSize();
$ODrow.costMs=Number((performance.now()-$ODstart).toFixed(2));
$ODput($ODrow)}catch{}};
setInterval($ODsample,$ODms).unref();
process.on("${HEAP_SNAPSHOT_SIGNAL}",()=>{
let $ODpath=$ODfile+"."+process.pid+"."+$ODsnaps++ +".heapsnapshot",$ODstart=performance.now();
try{$ODfs.writeFileSync($ODpath,globalThis.Bun.generateHeapSnapshot("v8"));$ODput({t:Date.now(),pid:process.pid,snapshot:$ODpath,ms:Math.round(performance.now()-$ODstart)})}
catch($ODerror){$ODput({t:Date.now(),pid:process.pid,snapshotFailed:String($ODerror)})}});
return $ODsample})();
`;

export const heapPatches: readonly Patch[] = [
  {
    name: 'heap-sampler',
    find: HEAP_ANCHOR,
    replace: SAMPLER,
  },
];
