import { CACHE_CLOCK_GLOBAL, CACHE_TRUSTED_MS } from './cache-clock.ts';
import type { Patch } from './patches.ts';

const TURN_CLOCK_STATE =
  '$ODc={session:null,sent:0,done:0,busy:!1},' +
  '$ODa=($ODms)=>{let $ODmin=Math.floor($ODms/6e4);if($ODmin<1)return"<1m";if($ODmin<60)return $ODmin+"m";' +
  'let $ODhr=Math.floor($ODmin/60);if($ODhr<24)return $ODhr+"h";return Math.floor($ODhr/24)+"d"},' +
  '$ODt=($ODid)=>{try{return L().getSessionStateManager().getSessionManager($ODid)' +
  '?.getDroidWorkingStateChangedAtMs()||Date.now()}catch{return Date.now()}}';

const TURN_CLOCK_TICK =
  `let $ODlast=Math.max($ODc.sent,$ODc.done),$ODcat=${CACHE_CLOCK_GLOBAL}?.get(F)?.at??0,$ODexp=$ODcat&&$ODcat+${CACHE_TRUSTED_MS},` +
  '$ODnow=$ODlast||$ODcat?Date.now():0,[$ODtick,$ODretick]=A(0);' +
  'v(()=>{let $ODat=Date.now(),$ODwait=1/0;' +
  'if($ODlast){let $ODage=$ODat-$ODlast,$ODstep=$ODage<36e5?6e4:$ODage<864e5?36e5:864e5;$ODwait=$ODstep-$ODage%$ODstep}' +
  'if($ODcat&&$ODexp>$ODat)$ODwait=Math.min($ODwait,($ODexp-$ODat)%6e4+1);' +
  'if($ODwait===1/0)return;' +
  'let $ODtimer=setTimeout(()=>$ODretick(($ODn)=>$ODn+1),$ODwait);' +
  'return()=>clearTimeout($ODtimer)},[$ODlast,$ODcat,$ODtick]);';

const TURN_CLOCK_TRACK =
  'let $ODbusy=B!=="idle";' +
  'if($ODc.session!==F)$ODc.session=F,$ODc.sent=0,$ODc.done=0,$ODc.busy=$ODbusy;' +
  'else if($ODbusy!==$ODc.busy)$ODc.busy=$ODbusy,$ODbusy?$ODc.sent=$ODt(F):$ODc.done=$ODt(F);';

const TURN_CLOCK_PARTS =
  'let $ODago=[];if($ODlast||$ODcat){' +
  'if($ODc.sent)$ODago.push(rt("\\u2191"+$ODa($ODnow-$ODc.sent),{color:o.text.muted}));' +
  'if($ODc.done)$ODago.push(rt(($ODc.sent?" ":"")+"\\u2193"+$ODa($ODnow-$ODc.done),{color:o.text.muted}));' +
  'if($ODcat){let $ODrem=$ODexp-$ODnow;if($ODago.length)$ODago.push(rt(", ",{color:o.text.muted}));' +
  `$ODago.push($ODrem>0?rt("cache "+$ODa(Math.min($ODrem,${CACHE_TRUSTED_MS - 1})),{color:o.text.muted}):rt("cache cold",{color:o.warning}))}}` +
  'if($ODago.length){let $ODbr=fe||"[]",$ODcut=$ODbr.indexOf(",");if($ODcut<0)$ODcut=$ODbr.length-1;' +
  'sd(Ie,[rt($ODbr.slice(0,$ODcut)+(fe?", ":""),{color:o.text.muted}),...$ODago,rt($ODbr.slice($ODcut),{color:o.text.muted})]," ")}' +
  'else if(fe)sd(Ie,[rt(fe,{color:o.text.muted})]," ");';

export const turnClockPatches: readonly Patch[] = [
  {
    name: 'turn-clock-state',
    find: 'var Jce=new Set(["thinking","streaming","compressing","executing_tool"]),eue="\\uF418",',
    lookups: [')return"idle";return L().getSessionStateManager().getSessionManager('],
    replace: `var ${TURN_CLOCK_STATE},Jce=new Set(["thinking","streaming","compressing","executing_tool"]),eue="\\uF418",`,
  },
  {
    name: 'turn-clock-track',
    find: 'isSessionArchived:de,updateNoticeDisplay:me}){let fe=rue(',
    lookups: [
      'let fe=rue({statusState:B,sessionId:F,',
      'K]=A(()=>{if(z.sessionId!==null&&',
      'v(()=>()=>{let ',
    ],
    replace: `isSessionArchived:de,updateNoticeDisplay:me}){${TURN_CLOCK_TRACK}${TURN_CLOCK_TICK}let fe=rue(`,
  },
  {
    name: 'turn-clock-parts',
    find: 'if(fe)sd(Ie,[rt(fe,{color:o.text.muted})]," ");',
    replace: TURN_CLOCK_PARTS,
  },
];
