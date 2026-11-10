import type { Patch } from './patches.ts';

export const SCOPE_SCHEDULE_LIMIT = 2000;
export const SCOPE_FIRE_LIMIT = 2000;
export const SCOPE_FOOTER_LIMIT = 200;
export const SCOPE_ANCESTRY_LIMIT = 12;

const STACK =
  '()=>{let $ODlimit=Error.stackTraceLimit;try{Error.stackTraceLimit=64;' +
  'return(new Error().stack??"").split("\\n").slice(2,34).join("\\n")}' +
  'finally{Error.stackTraceLimit=$ODlimit}}';

export const SCOPE_DIAG_RUNTIME =
  '(($ODfs,$ODpath)=>{' +
  '$ODfs.closeSync($ODfs.openSync($ODpath,"a",384));' +
  'let $ODids=new WeakMap,$ODtasks=new WeakMap,$ODnextScope=0,$ODnextCallback=0,$ODancestry=[],' +
  '$ODcounts={schedule:0,fire:0,"footer-render":0},' +
  `$ODstack=${STACK},` +
  '$ODcurrent=()=>globalThis.__odScopeCurrent?.(),' +
  '$ODscope=($ODvalue)=>{if(!$ODvalue)return null;' +
  'let $ODid=$ODids.get($ODvalue);if(!$ODid)$ODids.set($ODvalue,$ODid=++$ODnextScope);' +
  'return{scopeId:$ODid,sessionId:$ODvalue.currentSessionId??null,disposed:!!$ODvalue.disposed,disposing:!!$ODvalue.disposing}},' +
  '$ODwrite=($ODevent,$ODdetail)=>$ODfs.appendFileSync($ODpath,JSON.stringify({' +
  't:new Date().toISOString(),pid:process.pid,event:$ODevent,...$ODdetail})+"\\n"),' +
  '$ODbounded=($ODevent,$ODdetail)=>{' +
  `let $ODlimit=$ODevent==="schedule"?${SCOPE_SCHEDULE_LIMIT}:$ODevent==="footer-render"?${SCOPE_FOOTER_LIMIT}:${SCOPE_FIRE_LIMIT};` +
  'if($ODcounts[$ODevent]++<$ODlimit)$ODwrite($ODevent,$ODdetail);' +
  'else if($ODcounts[$ODevent]===$ODlimit+1)$ODwrite("limit",{kind:$ODevent,limit:$ODlimit})},' +
  '$ODcapture=($ODkind)=>{let $ODowner=$ODcurrent(),$ODmeta={' +
  'callbackId:++$ODnextCallback,kind:$ODkind,scheduledScope:$ODscope($ODowner),' +
  `scheduleStack:$ODstack(),parent:$ODancestry.slice(-${SCOPE_ANCESTRY_LIMIT})};` +
  'if($ODowner)$ODbounded("schedule",$ODmeta);return{meta:$ODmeta,owner:$ODowner,reported:!1}},' +
  '$ODinvoke=($ODrecord,$ODfn,$ODthis,$ODargs)=>{' +
  'if(!$ODrecord)return Reflect.apply($ODfn,$ODthis,$ODargs);' +
  'let $ODprevious=$ODancestry,$ODactive=$ODcurrent(),$ODframe={' +
  '...$ODrecord.meta,ownerAtFire:$ODscope($ODrecord.owner),firedScope:$ODscope($ODactive),fireStack:$ODstack()};' +
  'delete $ODframe.parent;' +
  `$ODancestry=[...$ODrecord.meta.parent,$ODframe].slice(-${SCOPE_ANCESTRY_LIMIT});` +
  'try{if(!$ODrecord.reported&&($ODactive?.disposed||$ODactive?.disposing||$ODrecord.owner?.disposed||$ODrecord.owner?.disposing))' +
  '$ODrecord.reported=!0,$ODbounded("fire",{...$ODframe,ancestry:$ODancestry});' +
  'return Reflect.apply($ODfn,$ODthis,$ODargs)}finally{$ODancestry=$ODprevious}},' +
  '$ODapi={' +
  'lifecycle:($ODevent,$ODowner)=>$ODwrite($ODevent,{scope:$ODscope($ODowner),activeScope:$ODscope($ODcurrent()),ancestry:$ODancestry,stack:$ODstack()}),' +
  'footer:()=>{let $ODowner=$ODcurrent();if($ODowner)$ODbounded("footer-render",{activeScope:$ODscope($ODowner),ancestry:$ODancestry,stack:$ODstack()})},' +
  'wrap:($ODfn,$ODkind)=>{let $ODrecord=$ODcapture($ODkind);return function(...$ODargs){return $ODinvoke($ODrecord,$ODfn,this,$ODargs)}},' +
  'task:($ODtask)=>{$ODtasks.set($ODtask,$ODcapture("react-task"))},' +
  'fireTask:($ODtask,$ODfn,$ODthis,$ODargs)=>$ODinvoke($ODtasks.get($ODtask),$ODfn,$ODthis,$ODargs)};' +
  '$ODwrite("init",{});return $ODapi})(require("fs"),process.env.OD_SCOPE_LOG)';

const CURRENT = 'static getCurrent(){return Sp.storage.getStore()}';
const DISPOSE =
  'async dispose(){if(this.disposed)return;if(!this.disposalPromise)this.disposing=!0,';
const INACTIVE = 'assertActive(){if(this.disposed||this.disposing)throw new o(this)}';
const TICKER =
  'function Xe1(h){if(xS.add(h),!uf)yS=Date.now(),uf=setInterval(()=>{yS=Date.now();for(let L of xS)L()},FY);return()=>{if(xS.delete(h),xS.size===0&&uf)clearInterval(uf),uf=void 0}}';
const TICK = '()=>{yS=Date.now();for(let L of xS)L()}';
const REACT_TASK =
  'e={id:Vy++,callback:i,priorityLevel:e,startTime:l,expirationTime:c,sortIndex:-1},l>g?';
const REACT_FIRE = 'xe.callback=null,Xt=xe.priorityLevel;var c=g(xe.expirationTime<=e);';
const REACT_IMMEDIATE = 'if(typeof wQ==="function")Ka=function(){wQ(cc)};';
const FOOTER_SETTINGS =
  'r1=e1!=="0s",o1=m().getShowTokenUsageIndicator()&&g!==null&&g!==void 0&&g>0?WN1(g??null):null;';

export const scopeDiagPatches: readonly Patch[] = [
  {
    name: 'scope-diag-runtime',
    find: CURRENT,
    replace:
      `${CURRENT}static{if(process.env.OD_SCOPE_LOG){globalThis.__odScopeCurrent=()=>this.getCurrent();` +
      `globalThis.__odScopeDiag??=${SCOPE_DIAG_RUNTIME}}}`,
  },
  {
    name: 'scope-diag-dispose-start',
    find: DISPOSE,
    replace: DISPOSE.replace(
      'this.disposing=!0,',
      'globalThis.__odScopeDiag?.lifecycle("dispose-start",this),this.disposing=!0,',
    ),
  },
  {
    name: 'scope-diag-inactive-read',
    find: INACTIVE,
    replace:
      'assertActive(){if(this.disposed||this.disposing){' +
      'globalThis.__odScopeDiag?.lifecycle("inactive-read",this);throw new o(this)}}',
  },
  {
    name: 'scope-diag-ui-ticker',
    find: TICKER,
    replace: TICKER.replace(
      `setInterval(${TICK},FY)`,
      `setInterval(globalThis.__odScopeDiag?.wrap(${TICK},"ui-ticker")??(${TICK}),FY)`,
    ),
  },
  {
    name: 'scope-diag-react-task',
    find: REACT_TASK,
    replace: REACT_TASK.replace(',l>g?', ',globalThis.__odScopeDiag?.task(e),l>g?'),
  },
  {
    name: 'scope-diag-react-fire',
    find: REACT_FIRE,
    replace: REACT_FIRE.replace(
      'g(xe.expirationTime<=e)',
      'globalThis.__odScopeDiag?globalThis.__odScopeDiag.fireTask(xe,g,void 0,[xe.expirationTime<=e]):g(xe.expirationTime<=e)',
    ),
  },
  {
    name: 'scope-diag-react-immediate',
    find: REACT_IMMEDIATE,
    replace: REACT_IMMEDIATE.replace(
      'wQ(cc)',
      'wQ(globalThis.__odScopeDiag?.wrap(cc,"react-immediate")??cc)',
    ),
  },
  {
    name: 'scope-diag-react-host-schedulers',
    find: 'supportsMicrotasks:!0,',
    until: 'cancelTimeout:clearTimeout,',
    replace:
      'supportsMicrotasks:!0,' +
      'scheduleMicrotask:function($ODcallback,...$ODargs){let $ODwork=globalThis.__odScopeDiag?.wrap($ODcallback,"react-microtask")??$ODcallback;' +
      'return typeof $ODroot==="function"?queueMicrotask(()=>$ODroot($ODwork)):Reflect.apply(queueMicrotask,this,[$ODwork,...$ODargs])},' +
      'scheduleTimeout:function($ODcallback,...$ODargs){let $ODwork=globalThis.__odScopeDiag?.wrap($ODcallback,"react-timeout")??$ODcallback;' +
      'return typeof $ODroot==="function"?setTimeout(()=>$ODroot($ODwork,...$ODargs.slice(1)),$ODargs[0]):Reflect.apply(setTimeout,this,[$ODwork,...$ODargs])},' +
      'cancelTimeout:clearTimeout,',
  },
  {
    name: 'scope-diag-footer-settings',
    find: FOOTER_SETTINGS,
    replace: FOOTER_SETTINGS.replace('o1=m()', 'o1=(globalThis.__odScopeDiag?.footer(),m())'),
  },
];
