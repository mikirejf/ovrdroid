import { CACHE_CLOCK_GLOBAL, CACHE_CLOCK_RUNTIME_GLOBAL, CACHE_TRUSTED_MS } from './cache-clock.ts';
import type { Patch } from './patches.ts';

const TURN_CLOCK_STATE =
  '$ODc={session:null,sent:0,done:0,busy:!1},' +
  '$ODa=($ODms)=>{let $ODmin=Math.floor($ODms/6e4);if($ODmin<1)return"<1m";if($ODmin<60)return $ODmin+"m";' +
  'let $ODhr=Math.floor($ODmin/60);if($ODhr<24)return $ODhr+"h";return Math.floor($ODhr/24)+"d"},' +
  '$ODt=($ODid)=>{try{return L().getSessionStateManager().getSessionManager($ODid)' +
  '?.getDroidWorkingStateChangedAtMs()||Date.now()}catch{return Date.now()}}';

const TURN_CLOCK_TICK =
  `let $ODlast=Math.max($ODc.sent,$ODc.done),$ODce=${CACHE_CLOCK_GLOBAL}?.get(w),$ODcat=$ODce?.at??0,$ODexp=$ODcat&&$ODcat+${CACHE_TRUSTED_MS},` +
  '$ODnow=$ODlast||$ODcat?Date.now():0,[$ODtick,$ODretick]=_(0);' +
  `W(()=>{let $ODclock=${CACHE_CLOCK_RUNTIME_GLOBAL};if(!$ODclock)return;$ODclock.load(w);return $ODclock.listen(()=>$ODretick(($ODn)=>$ODn+1))},[w]);` +
  'W(()=>{let $ODat=Date.now(),$ODwait=1/0;' +
  'if($ODlast){let $ODage=$ODat-$ODlast,$ODstep=$ODage<36e5?6e4:$ODage<864e5?36e5:864e5;$ODwait=$ODstep-$ODage%$ODstep}' +
  'if($ODcat&&$ODexp>$ODat)$ODwait=Math.min($ODwait,($ODexp-$ODat)%6e4+1);' +
  'if($ODwait===1/0)return;' +
  'let $ODtimer=setTimeout(()=>$ODretick(($ODn)=>$ODn+1),$ODwait);' +
  'return()=>clearTimeout($ODtimer)},[$ODlast,$ODcat,$ODtick]);';

const TURN_CLOCK_TRACK =
  'let $ODbusy=x!=="idle";' +
  'if($ODc.session!==w)$ODc.session=w,$ODc.sent=0,$ODc.done=0,$ODc.busy=$ODbusy;' +
  'else if($ODbusy!==$ODc.busy)$ODc.busy=$ODbusy,$ODbusy?$ODc.sent=$ODt(w):($ODc.done=$ODt(w),queueMicrotask(()=>df().refresh()));';

const TURN_CLOCK_HEAD =
  '$ODhead=(()=>{let $ODago=[];if($ODlast||$ODcat){' +
  'if($ODc.sent)$ODago.push(lt("\\u2191"+$ODa($ODnow-$ODc.sent),{color:a.text.muted}));' +
  'if($ODc.done)$ODago.push(lt(($ODc.sent?" ":"")+"\\u2193"+$ODa($ODnow-$ODc.done),{color:a.text.muted}));' +
  `if($ODcat){let $ODrem=$ODexp-$ODnow,$ODloaded=$ODce.loaded?${CACHE_CLOCK_RUNTIME_GLOBAL}.view($ODce,$ODnow):null;if($ODago.length)$ODago.push(lt(", ",{color:a.text.muted}));` +
  '$ODago.push($ODloaded?lt($ODloaded.text,{color:$ODloaded.warn?a.warning:a.text.muted}):' +
  `$ODrem>0?lt("cache "+$ODa(Math.min($ODrem,${CACHE_TRUSTED_MS - 1})),{color:a.text.muted}):lt("cache cold",{color:a.warning}))}}` +
  'if(!$ODago.length)return ye?[lt(ye,{color:a.text.muted})]:[];' +
  'let $ODbr=ye||"[]",$ODcut=$ODbr.indexOf(",");if($ODcut<0)$ODcut=$ODbr.length-1;' +
  'return[lt($ODbr.slice(0,$ODcut)+(ye?", ":""),{color:a.text.muted}),...$ODago,lt($ODbr.slice($ODcut),{color:a.text.muted})]})()';

export const turnClockPatches: readonly Patch[] = [
  {
    name: 'turn-clock-state',
    find: 'var Jce=new Set(["thinking","streaming","compressing","executing_tool"]),eue="\\uF418",',
    lookups: [')return"idle";return L().getSessionStateManager().getSessionManager('],
    replace: `var ${TURN_CLOCK_STATE},Jce=new Set(["thinking","streaming","compressing","executing_tool"]),eue="\\uF418",`,
  },
  {
    name: 'turn-clock-track',
    find: 'droidsHint:se,remoteDroidLocation:ce}){let ye=Ehe(',
    lookups: [
      'let ye=Ehe({statusState:x,sessionId:w,',
      'L]=_(()=>{if(I.sessionId!==null&&',
      'W(()=>()=>{let Z=q.current,',
      'df(),K=V.subscribe(J),Y=setInterval(()=>{V.refresh()},',
    ],
    replace: `droidsHint:se,remoteDroidLocation:ce}){${TURN_CLOCK_TRACK}${TURN_CLOCK_TICK}let ye=Ehe(`,
  },
  {
    name: 'turn-clock-parts',
    find: ',Me=(We)=>{let it=ye?[lt(ye,{color:a.text.muted})]:[];',
    replace: `,${TURN_CLOCK_HEAD},Me=(We)=>{let it=[...$ODhead];`,
  },
];
