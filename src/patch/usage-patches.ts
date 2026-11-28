import { OVRDROID_UNDER_HOME } from '../paths.ts';
import type { Patch } from './patches.ts';

const USAGE_LOG_FILE = 'cache-usage.jsonl';
const CACHE_MISS_WARNING =
  'if(x)r("[Prompt-Caching] Outgoing request is not append-only; prompt cache may be broken",{sessionId:s,assistantMessageId:o,modelId:c,apiProvider:y,name:"prompt_cache_miss_detected",type:"llm_prompt_cache",value:x});';

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
    name: 'cache-miss-usage-log',
    find: CACHE_MISS_WARNING,
    replace: `${CACHE_MISS_WARNING}if(x)try{${USAGE_LOG_OPEN}__odUsage({t:Date.now(),s:s,m:c,miss:x})}catch{}`,
  },
];
