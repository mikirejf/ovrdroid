import { readFileSync } from 'node:fs';
import path from 'node:path';

import { CONFIG_LOAD, CONFIG_PATHS, configSave } from './ovrdroid-config.ts';
import type { Patch } from './patches.ts';
import { PAYLOAD_PREFIX } from './rebase.ts';
import { freeNames, renameIn } from './tokens.ts';

export const RENDERS_VARIABLE = 'OD_RENDERS';
export const RENDERS_COMMAND = 'renders';
export const RENDERS_DIR = 'ovrdroid-renders';
export const RENDERS_USAGE = `Usage: /${RENDERS_COMMAND} [on|off]`;
export const SOURCE_CHARS = 240;

const RENDERS_KEY = 'renders';
const FLUSH_MS = 60_000;

export const PROFILING_FILE = path.join(
  import.meta.dir,
  'vendor',
  'react-reconciler-0.33.0.profiling.js.txt',
);

const COMMAND_DESCRIPTION =
  'Record which React components render, read later with probe renders-log (on, off)';

const REACT_REQUIRE = 'require("react")';
const SCHEDULER_REQUIRE = 'require("scheduler")';
const REACT_STAND_IN = '{__CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE:IX}';
const SCHEDULER_STAND_IN = 'yn';
const LABEL_FOLLOWERS = '(?=\\{|for\\b|do\\b|while\\b|switch\\b|if\\b|var\\b|let\\b|try\\b)';

export const RENDER_WALK =
  'function(){' +
  'let $ODinfos=new WeakMap,$ODnext=0,' +
  '$ODcomposite=($ODt)=>$ODt===0||$ODt===1||$ODt===11||$ODt===15,' +
  '$ODunwrap=($ODf)=>$ODf.tag===11?$ODf.type.render:$ODf.type,' +
  '$ODname=($ODf,$ODt)=>{let $ODe=$ODf.elementType,$ODw=$ODf.type;return $ODe&&$ODe.displayName||$ODw&&$ODw.displayName||$ODt.displayName||$ODt.name||"Anonymous"},' +
  '$ODkeys=($ODa,$ODb)=>{if($ODa==null||$ODb==null||$ODa===$ODb)return[];let $ODk=[];' +
  'for(let $ODx of Object.keys($ODa))if($ODa[$ODx]!==$ODb[$ODx])$ODk.push($ODx);' +
  'for(let $ODx of Object.keys($ODb))if(!Object.hasOwn($ODa,$ODx)&&$ODa[$ODx]!==$ODb[$ODx])$ODk.push($ODx);return $ODk},' +
  '$ODcontext=($ODp,$ODn)=>{let $ODa=$ODp.dependencies&&$ODp.dependencies.firstContext,$ODb=$ODn.dependencies&&$ODn.dependencies.firstContext;for(;$ODa&&$ODb;$ODa=$ODa.next,$ODb=$ODb.next){if($ODa.context!==$ODb.context)return!1;if(!Object.is($ODa.memoizedValue,$ODb.memoizedValue))return!0}return!1},' +
  '$ODstateful=($ODh)=>{let $ODq=$ODh.queue;return!!$ODq&&(Object.hasOwn($ODq,"pending")||Object.hasOwn($ODq,"value")&&typeof $ODq.getSnapshot==="function")},' +
  '$ODstate=($ODp,$ODn)=>{if($ODn.tag===1)return $ODkeys($ODp.memoizedState,$ODn.memoizedState).length>0;for(let $ODa=$ODp.memoizedState,$ODb=$ODn.memoizedState;$ODa&&$ODb;$ODa=$ODa.next,$ODb=$ODb.next)if($ODstateful($ODa)&&$ODa.memoizedState!==$ODb.memoizedState)return!0;return!1},' +
  '$ODself=($ODf)=>{let $ODs=$ODf.actualDuration||0;for(let $ODc=$ODf.child;$ODc;$ODc=$ODc.sibling)$ODs-=$ODc.actualDuration||0;return Math.round($ODs*1e3)/1e3};' +
  'return function($ODroot){let $ODout=[],$ODrefs=[],$ODtypes=[],' +
  '$ODinfoOf=($ODf)=>{let $ODt=$ODunwrap($ODf),$ODi=$ODinfos.get($ODt);if($ODi===void 0){' +
  `$ODi=[++$ODnext,$ODname($ODf,$ODt),Function.prototype.toString.call($ODt).slice(0,${SOURCE_CHARS}).split("").join("")];` +
  '$ODinfos.set($ODt,$ODi);$ODtypes.push($ODi)}return $ODi},' +
  '$ODrecord=($ODn,$ODp)=>{let $ODinfo=$ODinfoOf($ODn),$ODrow=[$ODinfo[0],$ODself($ODn)];$ODrefs.push($ODinfo);' +
  'if($ODp===null)return $ODrow.push("mount"),$ODrow;' +
  'let $ODwhy=[],$ODk=$ODkeys($ODp.memoizedProps,$ODn.memoizedProps);if($ODk.length>0)$ODwhy.push("props");if($ODstate($ODp,$ODn))$ODwhy.push("state");if($ODcontext($ODp,$ODn))$ODwhy.push("context");' +
  '$ODrow.push($ODwhy.length>0?$ODwhy.join("+"):"parent");if($ODk.length>0)$ODrow.push($ODk);return $ODrow},' +
  '$ODvisit=($ODn)=>{let $ODp=$ODn.alternate;if($ODcomposite($ODn.tag)&&($ODp===null||($ODn.flags&1)===1))$ODout.push($ODrecord($ODn,$ODp));' +
  'if($ODp!==null&&$ODp.child===$ODn.child)return;for(let $ODc=$ODn.child;$ODc;$ODc=$ODc.sibling)$ODvisit($ODc)};' +
  '$ODvisit($ODroot);return{renders:$ODout,refs:$ODrefs,types:$ODtypes}}}';

export const RENDER_GATE =
  `let $ODprobe=process.env.${RENDERS_VARIABLE},${CONFIG_PATHS},${CONFIG_LOAD},` +
  `$ODon=globalThis.__REACT_DEVTOOLS_GLOBAL_HOOK__===void 0&&(!!$ODprobe||$ODload().${RENDERS_KEY}===!0);`;

const PROBE_SINK =
  'let $ODfd=$ODfs.openSync($ODprobe,"a");' +
  '$ODsink=($ODrender,$ODwalked,$ODw)=>{let $ODline={t:Date.now(),pid:process.pid,' +
  'renderMs:Math.round($ODrender*1e3)/1e3,walkMs:Math.round($ODwalked*1e3)/1e3,renders:$ODw.renders};' +
  'if($ODw.types.length>0)$ODline.types=$ODw.types;$ODfs.writeSync($ODfd,JSON.stringify($ODline)+"\\n")}';

const DAILY_SINK =
  'let $ODround=($ODk,$ODv)=>typeof $ODv==="number"&&!Number.isInteger($ODv)?Math.round($ODv*1e3)/1e3:$ODv,' +
  '$ODday,$ODnextDay=0,$ODtotal,$ODdirty=!1,' +
  '$ODreset=()=>{let $ODd=new Date(Date.now());' +
  '$ODday=$ODd.getFullYear()+"-"+String($ODd.getMonth()+1).padStart(2,"0")+"-"+String($ODd.getDate()).padStart(2,"0");' +
  '$ODnextDay=new Date($ODd.getFullYear(),$ODd.getMonth(),$ODd.getDate()+1).getTime();' +
  '$ODtotal={pid:process.pid,day:$ODday,commits:0,renderMs:0,walkMs:0,first:0,last:0,components:new Map}};' +
  '$ODflush=()=>{if(!$ODdirty)return;$ODdirty=!1;' +
  `let $ODfolder=$ODdir+"/${RENDERS_DIR}/"+$ODday,$ODpath=$ODfolder+"/"+process.pid+".json",$ODtmp=$ODpath+".tmp";` +
  'try{$ODfs.mkdirSync($ODfolder,{recursive:!0});' +
  '$ODfs.writeFileSync($ODtmp,JSON.stringify({...$ODtotal,components:[...$ODtotal.components.values()]},$ODround));' +
  '$ODfs.renameSync($ODtmp,$ODpath)}catch{try{$ODfs.rmSync($ODtmp,{force:!0})}catch{}}};' +
  '$ODreset();' +
  '$ODsink=($ODrender,$ODwalked,$ODw)=>{let $ODnow=Date.now();if($ODnow>=$ODnextDay)$ODflush(),$ODreset();' +
  '$ODtotal.commits++;$ODtotal.renderMs+=$ODrender;$ODtotal.walkMs+=$ODwalked;$ODtotal.first||=$ODnow;$ODtotal.last=$ODnow;' +
  'for(let $ODj=0;$ODj<$ODw.renders.length;$ODj++){let[,$ODself,$ODwhy,$ODkeys]=$ODw.renders[$ODj],[,$ODn,$ODs]=$ODw.refs[$ODj],$ODc=$ODtotal.components.get($ODs);' +
  'if($ODc===void 0)$ODc={name:$ODn,source:$ODs,renders:0,selfMs:0,reasons:{},props:{}},$ODtotal.components.set($ODs,$ODc);' +
  '$ODc.renders++;$ODc.selfMs+=$ODself;for(let $ODpart of $ODwhy.split("+"))$ODc.reasons[$ODpart]=($ODc.reasons[$ODpart]||0)+1;' +
  'if($ODkeys)for(let $ODk of $ODkeys)$ODc.props[$ODk]=($ODc.props[$ODk]||0)+1}' +
  '$ODdirty=!0};' +
  `setInterval($ODflush,${FLUSH_MS}).unref();process.on("exit",$ODflush)`;

export const RENDER_HOOK =
  `let $ODfs=require("fs"),$ODwalk=(${RENDER_WALK})(),$ODsink,$ODflush=()=>{};` +
  `if($ODprobe){${PROBE_SINK}}else{${DAILY_SINK}}` +
  'globalThis.$ODr=globalThis.__REACT_DEVTOOLS_GLOBAL_HOOK__={supportsFiber:!0,inject(){return 1},' +
  'onCommitFiberRoot($ODid,$ODroot){let $ODfrom=performance.now(),$ODcur=$ODroot.current,$ODw=$ODwalk($ODcur);' +
  '$ODsink($ODcur.actualDuration||0,performance.now()-$ODfrom,$ODw)},' +
  'onCommitFiberUnmount(){},onPostCommitFiberRoot(){},flush:$ODflush};';

export const RENDERS_TOGGLE =
  `($ODarg)=>{let ${CONFIG_PATHS},${CONFIG_LOAD},` +
  `$ODword=$ODarg?.toLowerCase(),$ODon=$ODword==="on"?!0:$ODword==="off"?!1:$ODword===void 0?$ODload().${RENDERS_KEY}!==!0:null,` +
  '$ODnow=globalThis.$ODr?" This Droid is recording now.":" This Droid is not recording now.";' +
  `if($ODon===null)return ${JSON.stringify(`${RENDERS_USAGE}.`)}+$ODnow;` +
  `${configSave(`${RENDERS_KEY}:$ODon`)}let $ODfailure=$ODsave();` +
  'if($ODfailure!==void 0)return"Could not save the render recording setting: "+$ODfailure+"."+$ODnow;' +
  `return($ODon?"Render recording on from the next Droid start. Data: "+$ODdir+"/${RENDERS_DIR}":"Render recording off from the next Droid start")+"."+$ODnow}`;

interface MinifyingOptions extends Bun.TranspilerOptions {
  minify: { whitespace: boolean; identifiers: boolean };
}

const MINIFYING: MinifyingOptions = {
  loader: 'js',
  minify: { whitespace: true, identifiers: true },
};

function minify(source: string): string {
  return new Bun.Transpiler(MINIFYING).transformSync(source);
}

function survivingPayloadNames(source: string): string[] {
  const minified = minify(`globalThis.check=function(module,exports,require){${source}}`);
  return [...new Set(minified.match(/\$OD[\w$]*/gu))];
}

export function ownNames(raw: string): string {
  const minified = minify(raw);
  if (minified.includes(PAYLOAD_PREFIX)) {
    throw new Error(`the library already uses the ${PAYLOAD_PREFIX} prefix`);
  }
  const labels = new Set(
    [...minified.matchAll(/\b(?:break|continue) (?<label>[A-Za-z_$][\w$]*)/gu)].map(
      (match) => match.groups?.['label'] ?? '',
    ),
  );
  let renamed = renameIn(
    minified,
    new Map(freeNames(minified).map((name) => [name, `${PAYLOAD_PREFIX}${name}`])),
  );
  for (const label of labels) {
    renamed = renamed.replaceAll(
      new RegExp(`\\{${label.replaceAll('$', '\\$')}:${LABEL_FOLLOWERS}`, 'gu'),
      `{${PAYLOAD_PREFIX}${label}:`,
    );
  }

  const unowned = freeNames(renamed);
  if (unowned.length > 0) {
    throw new Error(`short names left after renaming: ${unowned.join(' ')}`);
  }
  const survivors = survivingPayloadNames(renamed);
  if (survivors.length > 0) {
    throw new Error(
      `renaming changed what the code means: ${survivors.join(' ')} survive a minify, so each is a global or a property key, not a local`,
    );
  }
  return renamed;
}

function swapRequire(source: string, request: string, expression: string): string {
  if (!source.includes(request)) {
    throw new Error(`the profiling reconciler has no ${request}`);
  }
  return source.replaceAll(request, expression);
}

const RECONCILER_START =
  'var ss=T(function(JH,yl){v();ZE();yl.exports=function(e){function i(A,t,n,a){return new MQ(A,t,n,a)}function l(){}function u(A){var t="https://react.dev/errors/"+A;';
const RECONCILER_HEAD = 'var ss=T(function(JH,yl){v();ZE();';

function reconcilerReplace(profiling: string): string {
  const body = swapRequire(
    swapRequire(ownNames(profiling), REACT_REQUIRE, REACT_STAND_IN),
    SCHEDULER_REQUIRE,
    SCHEDULER_STAND_IN,
  );
  const stockRest = RECONCILER_START.slice(RECONCILER_HEAD.length);
  return `${RECONCILER_HEAD}${RENDER_GATE}if($ODon){${RENDER_HOOK}((exports,module)=>{${body}})(JH,yl);return}${stockRest}`;
}

export function reconcilerPatch(read: () => string): Patch {
  let replace: string | undefined;
  return {
    name: 'render-profile',
    find: RECONCILER_START,
    lookups: ['go=Array.isArray,uA=IX,{rendererVersion:', 'var yn={};QL(yn,{unstable_now:()=>'],
    get replace(): string {
      replace ??= reconcilerReplace(read());
      return replace;
    },
  };
}

const injectPatch: Patch = {
  name: 'render-profile-inject',
  find: ',fl())me.injectIntoDevTools();',
  replace: ',fl()||globalThis.$ODr)me.injectIntoDevTools();',
};

const CATALOG_NEIGHBOUR =
  'tree:{name:"tree",description:"Navigate the session fork tree",category:"session"},';

const COMMAND_START = '{account:te,"agent-effectiveness-report":TY,';

const BUSY_START = '{new:"confirm-interrupt",clear:"confirm-interrupt",';

const COMMAND =
  `${RENDERS_COMMAND}:Hc({name:${JSON.stringify(RENDERS_COMMAND)},description:${JSON.stringify(COMMAND_DESCRIPTION)},` +
  `execute:($ODargs,$ODctx)=>{$ODctx.addEphemeralSystemMessage((${RENDERS_TOGGLE})($ODargs[0]),` +
  '{messageType:"system_notification",visibility:"user_only"});return{handled:!0}}}),';

export const renderProfilePatches: readonly Patch[] = [
  reconcilerPatch(() => readFileSync(PROFILING_FILE, 'utf-8')),
  injectPatch,
  {
    name: 'render-profile-command-catalog',
    find: CATALOG_NEIGHBOUR,
    replace: `${CATALOG_NEIGHBOUR}${RENDERS_COMMAND}:{name:${JSON.stringify(RENDERS_COMMAND)},description:${JSON.stringify(COMMAND_DESCRIPTION)},category:"config"},`,
  },
  {
    name: 'render-profile-command',
    find: COMMAND_START,
    lookups: ['dt=Hc({name:"vim"'],
    replace: `{${COMMAND}${COMMAND_START.slice(1)}`,
  },
  {
    name: 'render-profile-command-busy',
    find: BUSY_START,
    replace: `{${RENDERS_COMMAND}:"immediate",${BUSY_START.slice(1)}`,
  },
];
