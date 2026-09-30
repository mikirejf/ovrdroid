export const CACHE_CLOCK_GLOBAL = 'globalThis.__odCache';
export const CACHE_TRUSTED_MS = 45 * 60_000;

export const CACHE_CLOCK_RECORDERS =
  `function $ODCs($ODsnap){let $ODclock=${CACHE_CLOCK_GLOBAL}??=new Map;` +
  'ee($ODsnap.modelId).modelProvider==="anthropic"?$ODclock.set($ODsnap.sessionId,{at:$ODsnap.capturedAt}):$ODclock.delete($ODsnap.sessionId)}' +
  `function $ODCw($ODsid,$ODat){let $ODclock=${CACHE_CLOCK_GLOBAL};if($ODclock?.has($ODsid))$ODclock.set($ODsid,{at:$ODat})}`;
