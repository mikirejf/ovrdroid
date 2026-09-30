import { OVRDROID_UNDER_HOME } from '../paths.ts';
import type { Patch } from './patches.ts';

const USAGE_LOG_FILE = 'cache-usage.jsonl';

export const USAGE_LOG_OPEN =
  `globalThis.__odUsage??=(($ODfs,$ODdir)=>{let $ODfile=$ODdir+"/${USAGE_LOG_FILE}";try{$ODfs.mkdirSync($ODdir,{recursive:!0})}catch{}` +
  `return($ODrow)=>{$ODfs.appendFile($ODfile,JSON.stringify($ODrow)+"\\n",()=>{})}})` +
  `(require("fs"),require("os").homedir()+"/${OVRDROID_UNDER_HOME}");`;

export const usagePatches: readonly Patch[] = [
  {
    name: 'custom-openai-shared-cache-key',
    find: 'prompt_cache_key:We??s,prompt_cache_retention:',
    lookups: [',isCustomModel:g}='],
    replace: 'prompt_cache_key:We??(g?"ovrdroid":s),prompt_cache_retention:',
  },
  {
    name: 'cache-usage-log',
    find: 'commitTurnTokenUsage(t,s){if(!this.currentSessionId)return;',
    replace:
      'commitTurnTokenUsage(t,s){if(!this.currentSessionId)return;' +
      `if(!t.odWarm){${USAGE_LOG_OPEN}__odUsage({t:Date.now(),s:this.currentSessionId,m:s,in:t.inputTokens,cr:t.cacheReadTokens,cw:t.cacheCreationTokens,out:t.outputTokens,th:t.thinkingTokens})}`,
  },
  {
    name: 'cache-usage-log-promote',
    find: 'Zh.set(t,{capturedAt:s.capturedAt,attemptedAt:Date.now()}),',
    replace: `Zh.set(t,{capturedAt:s.capturedAt,attemptedAt:Date.now()}),${USAGE_LOG_OPEN}__odUsage({t:Date.now(),s:t,m:s.modelId,promote:!0}),`,
  },
];
