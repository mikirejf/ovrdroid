import type { Patch } from './patches.ts';

export const rootRenderPatches: readonly Patch[] = [
  {
    name: 'input-change-noop',
    find: 'onInputChange:(we)=>{if(we!==kt.current)lt();bi(we,{updateInput:!1})}',
    replace: 'onInputChange:(we)=>{if(we===kt.current)return;lt();bi(we,{updateInput:!1})}',
  },
  {
    name: 'decomp-miss-cache',
    find: 'let o=this.getSessionSummary();if(o?.decompSessionType)return this.currentDecompSessionType=o.decompSessionType,this.currentDecompMissionId=o.decompMissionId,o.decompSessionType;return this.currentDecompSessionType}',
    replace:
      'if(this.$ODdecompMiss===this.currentSessionId)return this.currentDecompSessionType;let o=this.getSessionSummary();if(o?.decompSessionType)return this.currentDecompSessionType=o.decompSessionType,this.currentDecompMissionId=o.decompMissionId,o.decompSessionType;if(o)this.$ODdecompMiss=this.currentSessionId;return this.currentDecompSessionType}',
  },
];
