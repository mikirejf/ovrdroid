import type { Patch } from './patches.ts';

export const SESSION_HEADER = 'X-Session-ID';

export const proxySessionPatches: readonly Patch[] = [
  {
    name: 'anthropic-custom-model-sends-session-id',
    find: 'L=async({customModel:xe,proxy:$e,customHeaders:Fe})=>xe?{...Fe,"User-Agent":t.platform.userAgent()}:await t.platform.createProxyHeaders($e)',
    replace: `L=async({customModel:xe,proxy:$e,customHeaders:Fe})=>xe?{...(xe.provider==="anthropic"&&$e?.sessionId?{"${SESSION_HEADER}":$e.sessionId}:{}),...Fe,"User-Agent":t.platform.userAgent()}:await t.platform.createProxyHeaders($e)`,
  },
];
