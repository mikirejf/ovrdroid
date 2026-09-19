import { OVRDROID_UNDER_HOME } from '../paths.ts';
import type { Patch } from './patches.ts';

const USAGE_LOG_FILE = 'cache-usage.jsonl';

const OPEN =
  `globalThis.__odUsage??=((F,d)=>{let f=d+"/${USAGE_LOG_FILE}";try{F.mkdirSync(d,{recursive:!0})}catch{}` +
  `return(o)=>{F.appendFile(f,JSON.stringify(o)+"\\n",()=>{})}})` +
  `(require("fs"),require("os").homedir()+"/${OVRDROID_UNDER_HOME}");`;

export const usagePatches: readonly Patch[] = [
  {
    name: 'cache-usage-log',
    find: 'commitTurnTokenUsage(t,r){if(!this.currentSessionId)return;',
    replace:
      'commitTurnTokenUsage(t,r){if(!this.currentSessionId)return;' +
      `${OPEN}__odUsage({t:Date.now(),s:this.currentSessionId,m:r,in:t.inputTokens,cr:t.cacheReadTokens,cw:t.cacheCreationTokens,out:t.outputTokens,th:t.thinkingTokens});`,
  },
  {
    name: 'cache-usage-log-promote',
    find: 'cb.set(t,{capturedAt:r.capturedAt,attemptedAt:Date.now()}),',
    replace: `cb.set(t,{capturedAt:r.capturedAt,attemptedAt:Date.now()}),${OPEN}__odUsage({t:Date.now(),s:t,m:r.modelId,promote:!0}),`,
  },
];
