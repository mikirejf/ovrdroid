import type { Patch } from './patches.ts';

export const rootRenderPatches: readonly Patch[] = [
  {
    name: 'decomp-miss-cache',
    find: 'let o=this.getSessionSummary();if(o?.decompSessionType)return this.currentDecompSessionType=o.decompSessionType,this.currentDecompMissionId=o.decompMissionId,o.decompSessionType;return this.currentDecompSessionType}',
    replace:
      'if(this.$ODdecompMiss===this.currentSessionId)return this.currentDecompSessionType;let o=this.getSessionSummary();if(o?.decompSessionType)return this.currentDecompSessionType=o.decompSessionType,this.currentDecompMissionId=o.decompMissionId,o.decompSessionType;if(o)this.$ODdecompMiss=this.currentSessionId;return this.currentDecompSessionType}',
  },
];
