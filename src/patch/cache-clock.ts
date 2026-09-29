export const CACHE_CLOCK_GLOBAL = 'globalThis.__odCache';
export const CACHE_TTL_MS = 60 * 60_000;

export const CACHE_CLOCK_RECORDERS =
  `function $ODCs(s){let m=${CACHE_CLOCK_GLOBAL}??=new Map;` +
  'ee(s.modelId).modelProvider==="anthropic"?m.set(s.sessionId,{at:s.capturedAt}):m.delete(s.sessionId)}' +
  `function $ODCw(t,a){let m=${CACHE_CLOCK_GLOBAL};if(m?.has(t))m.set(t,{at:a})}`;
