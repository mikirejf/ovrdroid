import type { Patch } from './patches.ts';

export const STOCK_STATUS_MOUNT = 'function KIe({sessionId:f}){return zY(f),null}';

export const SUBAGENT_EVENTS =
  '["registered","load_state_changed","working_state_changed","metadata_updated","subagent_invocation_summary_updated"]';

export const BUSY_SIGNAL_PAYLOAD =
  'var $ODsession=null,$ODstate=!1,$ODtimer=null,$ODclearing=null,$ODexitHook=!1,$ODwatching=!1,$ODenabled;' +
  'function $ODwrite($ODprogress){process.stdout.write("\\x1B]9;4;"+$ODprogress+";\\x07")}' +
  'function $ODisEnabled(){if($ODenabled===void 0)$ODenabled=Boolean(process.stdout.isTTY&&' +
  '(String(process.env.TERM_PROGRAM??"").toLowerCase().includes("ghostty")||process.env.HERDR_ENV));' +
  'return $ODenabled}' +
  'function $ODsend($ODbusy){if($ODbusy){if($ODclearing)clearTimeout($ODclearing),$ODclearing=null;' +
  'if($ODstate)return;$ODstate=!0;' +
  'if(!$ODexitHook)$ODexitHook=!0,process.on("exit",()=>{if($ODstate)$ODwrite(0)});' +
  '$ODwrite(3);$ODtimer=setInterval(()=>$ODwrite(3),5000);$ODtimer.unref?.();return}' +
  'if(!$ODstate||$ODclearing)return;' +
  '$ODclearing=setTimeout(()=>{$ODclearing=null;$ODstate=!1;' +
  'if($ODtimer)clearInterval($ODtimer),$ODtimer=null;$ODwrite(0)},1500);$ODclearing.unref?.()}' +
  'function $ODisBusy(){if(!$ODsession)return!1;let $ODssm=N().getSessionStateManager();' +
  'if(($ODssm.getSessionManager($ODsession)?.getDroidWorkingState()??"idle")!=="idle")return!0;' +
  'for(let $ODagent of qme($ODssm,$ODsession))if($ODagent.status==="running")return!0;return!1}' +
  'function $ODrefresh(){try{$ODsend($ODisBusy())}catch{}}' +
  'function $ODfollow($ODid){if($ODid===$ODsession&&$ODwatching)return;$ODsession=$ODid??null;' +
  'if(!$ODisEnabled())return;try{if(!$ODwatching)$ODwatching=!0,' +
  `N().getSessionStateManager().subscribeToSessionEvents(${SUBAGENT_EVENTS},$ODrefresh)}catch{}` +
  '$ODrefresh()}';

export const PATCHED_STATUS_MOUNT = 'function KIe({sessionId:f}){return zY(f),$ODfollow(f),null}';

export const busySignalPatches: readonly Patch[] = [
  {
    name: 'progress-busy-while-session-or-subagents-work',
    find: STOCK_STATUS_MOUNT,
    lookups: [
      'ssm=N().getSessionStateManager();changes=Ts("SessionRosterStore"',
      'let A=qme(U,I);if(A.length===0)return GP;',
    ],
    replace: `${BUSY_SIGNAL_PAYLOAD}${PATCHED_STATUS_MOUNT}`,
  },
];
