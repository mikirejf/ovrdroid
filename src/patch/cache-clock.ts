import { OVRDROID_UNDER_HOME } from '../paths.ts';

export const CACHE_CLOCK_KEY = '__odCache';
export const CACHE_CLOCK_RUNTIME_KEY = '__odCacheClock';
export const CACHE_CLOCK_GLOBAL = `globalThis.${CACHE_CLOCK_KEY}`;
export const CACHE_CLOCK_RUNTIME_GLOBAL = `globalThis.${CACHE_CLOCK_RUNTIME_KEY}`;
export const CACHE_TRUSTED_MS = 45 * 60_000;
export const CACHE_CLOCK_DIR = 'cache-clock';
export const CACHE_CLOCK_KEEP_MS = 24 * 60 * 60_000;
export const FINGERPRINT_DELAY_MS = 3000;
export const FINGERPRINT_COMMAND = 'move-work';
export const FINGERPRINT_ARGS = ['parity'];
export const FINGERPRINT_INPUT = '{}';
export const FINGERPRINT_TIMEOUT_MS = 30_000;

export const CACHE_CLOCK_PURE =
  'function $ODCd($ODrecorded,$ODcurrent){' +
  'let $ODkeys=[...Object.keys($ODcurrent),...Object.keys($ODrecorded).filter(($ODkey)=>!($ODkey in $ODcurrent))];' +
  'return $ODkeys.filter(($ODkey)=>$ODrecorded[$ODkey]!==$ODcurrent[$ODkey])}' +
  'function $ODCv($ODentry,$ODnow,$ODmine){' +
  `if($ODnow-$ODentry.at>=${CACHE_TRUSTED_MS})return{text:"cache cold",warn:!0};` +
  'if(!$ODmine.done)return{text:"cache checking",warn:!1};' +
  'if(!$ODmine.setup||!$ODentry.setup)return{text:"cache unchecked",warn:!0};' +
  'let $ODdiff=$ODCd($ODentry.setup,$ODmine.setup);' +
  'return $ODdiff.length?{text:"cache cold: "+$ODdiff.join(", ")+" changed",warn:!0}:null}';

const PRUNE =
  '$ODprune=()=>$ODfs.promises.readdir($ODenv.dir).then(($ODnames)=>{' +
  'for(let $ODname of $ODnames)if($ODname.endsWith(".json")){let $ODsid=$ODname.slice(0,-5);' +
  '$ODqueue($ODsid,()=>$ODfs.promises.stat($ODfile($ODsid)).then(($ODstat)=>{' +
  `if(Date.now()-$ODstat.mtimeMs>${CACHE_CLOCK_KEEP_MS})return $ODfs.promises.unlink($ODfile($ODsid))})` +
  '.catch(($ODerr)=>{if($ODerr.code!=="ENOENT")throw $ODerr}))}})' +
  '.catch(($ODcause)=>{if($ODcause?.code!=="ENOENT")$ODenv.log("[ovrdroid] cache clock prune failed",{cause:$ODcause})})';

const FINGERPRINT =
  '$ODready=()=>$ODpending??=new Promise(($ODsettle)=>$ODenv.later(()=>{$ODprune();' +
  'let $ODend=($ODsetup)=>{$ODmine.done=!0,$ODmine.setup=$ODsetup,$ODsettle($ODsetup),$ODemit()},' +
  '$ODfail=($ODcause)=>{$ODenv.log("[ovrdroid] cache setup fingerprint failed",{cause:$ODcause}),$ODend(null)};' +
  `try{$ODenv.exec("${FINGERPRINT_COMMAND}",${JSON.stringify(FINGERPRINT_ARGS)},($ODerr,$ODout)=>{` +
  'try{if($ODerr)throw $ODerr;let $ODsetup=JSON.parse($ODout).setup;' +
  `if(!$ODsetup||typeof $ODsetup!=="object")throw new TypeError("${FINGERPRINT_COMMAND} parity printed no setup object");$ODend($ODsetup)}` +
  `catch($ODcause){$ODfail($ODcause)}}).stdin.end(${JSON.stringify(FINGERPRINT_INPUT)})}` +
  'catch($ODcause){$ODfail($ODcause)}}))';

const SAVE =
  '$ODqueue=($ODsid,$ODjob)=>{' +
  'let $ODnext=($ODqueues.get($ODsid)??Promise.resolve()).then($ODjob)' +
  '.catch(($ODcause)=>$ODenv.log("[ovrdroid] cache clock write failed",{sessionId:$ODsid,cause:$ODcause}));$ODqueues.set($ODsid,$ODnext)},' +
  '$ODsave=($ODsid)=>$ODready().then(($ODsetup)=>$ODqueue($ODsid,async()=>{' +
  'let $ODentry=$ODmap().get($ODsid);if(!$ODentry)return;' +
  'await $ODfs.promises.mkdir($ODenv.dir,{recursive:!0});' +
  'await $ODfs.promises.writeFile($ODfile($ODsid),JSON.stringify({at:$ODentry.at,setup:$ODsetup}))}))';

const LOAD =
  'load:($ODsid)=>{if($ODmap().has($ODsid)||$ODtried.has($ODsid))return;$ODtried.add($ODsid);' +
  '$ODfs.promises.readFile($ODfile($ODsid),"utf8").then(($ODtext)=>{' +
  'let $ODrec=JSON.parse($ODtext);if(typeof $ODrec.at!=="number")throw new TypeError("no timestamp");' +
  'if($ODmap().has($ODsid))return;' +
  '$ODmap().set($ODsid,{at:$ODrec.at,setup:$ODrec.setup??null,loaded:!0});' +
  `if(Date.now()-$ODrec.at<${CACHE_TRUSTED_MS})$ODready();$ODemit()})` +
  '.catch(($ODcause)=>{if($ODcause?.code!=="ENOENT")$ODenv.log("[ovrdroid] cache clock load failed",{sessionId:$ODsid,cause:$ODcause})})}';

const FORGET =
  'forget:($ODsid)=>{if($ODmap().delete($ODsid)||!$ODgone.has($ODsid)){$ODgone.add($ODsid);' +
  '$ODqueue($ODsid,()=>$ODfs.promises.unlink($ODfile($ODsid)).catch(($ODerr)=>{if($ODerr.code!=="ENOENT")throw $ODerr}))}}';

export const CACHE_CLOCK_FACTORY =
  `${CACHE_CLOCK_PURE}function $ODCf($ODenv){` +
  `let $ODfs=$ODenv.fs,$ODmap=()=>${CACHE_CLOCK_GLOBAL}??=new Map,$ODmine={done:!1,setup:null},` +
  '$ODlisteners=new Set,$ODtried=new Set,$ODgone=new Set,$ODqueues=new Map,$ODpending,' +
  '$ODemit=()=>{for(let $ODlisten of $ODlisteners)$ODlisten()},' +
  '$ODfile=($ODsid)=>$ODenv.dir+"/"+$ODsid+".json",' +
  `${FINGERPRINT},` +
  `${SAVE},` +
  `${PRUNE};` +
  'return{' +
  'record:($ODsid,$ODat)=>{$ODgone.delete($ODsid),$ODmap().set($ODsid,{at:$ODat}),$ODsave($ODsid)},' +
  'warm:($ODsid,$ODat)=>{if($ODmap().has($ODsid))$ODmap().set($ODsid,{at:$ODat}),$ODsave($ODsid)},' +
  `${FORGET},` +
  `${LOAD},` +
  'view:($ODentry,$ODnow)=>$ODCv($ODentry,$ODnow,$ODmine),' +
  'listen:($ODlisten)=>{$ODlisteners.add($ODlisten);return()=>$ODlisteners.delete($ODlisten)}}}';

export const CACHE_CLOCK_ENV =
  '{fs:require("fs"),' +
  `exec:($ODfile,$ODargs,$ODdone)=>require("child_process").execFile($ODfile,$ODargs,{timeout:${FINGERPRINT_TIMEOUT_MS}},$ODdone),` +
  `dir:require("os").homedir()+"/${OVRDROID_UNDER_HOME}/${CACHE_CLOCK_DIR}",` +
  'log:($ODmessage,$ODdetail)=>n($ODmessage,$ODdetail),' +
  `later:($ODstart)=>setTimeout($ODstart,${FINGERPRINT_DELAY_MS}).unref?.()}`;

export const CACHE_CLOCK_RECORDERS =
  `${CACHE_CLOCK_FACTORY}var $ODCr=${CACHE_CLOCK_RUNTIME_GLOBAL}=$ODCf(${CACHE_CLOCK_ENV});` +
  'function $ODCs($ODsnap){ee($ODsnap.modelId).modelProvider==="anthropic"?$ODCr.record($ODsnap.sessionId,$ODsnap.capturedAt):$ODCr.forget($ODsnap.sessionId)}' +
  'function $ODCw($ODsid,$ODat){$ODCr.warm($ODsid,$ODat)}';
