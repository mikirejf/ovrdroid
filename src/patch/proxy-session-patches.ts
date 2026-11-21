import type { Patch } from './patches.ts';

export const SESSION_HEADER = 'X-Session-ID';

export const proxySessionPatches: readonly Patch[] = [
  {
    name: 'anthropic-custom-model-sends-session-id',
    find: 'async({customModel:Ee,proxy:Ve,customHeaders:Ne})=>{if(!Ee)return await t.platform.createProxyHeaders(Ve);return{...Ne,',
    replace: `async({customModel:Ee,proxy:Ve,customHeaders:Ne})=>{if(!Ee)return await t.platform.createProxyHeaders(Ve);return{...(Ee.provider==="anthropic"&&Ve?.sessionId?{"${SESSION_HEADER}":Ve.sessionId}:{}),...Ne,`,
  },
];
