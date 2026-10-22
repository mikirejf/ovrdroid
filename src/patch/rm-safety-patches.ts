import type { Patch } from './patches.ts';

const WHOLE_TARGET_END = String.raw`(?:[\s;&|]|$)`;

export const HARD_BLOCK_STOCK = String.raw`/^rm\s+-rf\s+~\//,/^rm\s+-rf\s+\$HOME/,`;

export const HARD_BLOCK_WHOLE_TARGET = String.raw`/^rm\s+-rf\s+~\/\*?${WHOLE_TARGET_END}/,/^rm\s+-rf\s+\$HOME(?:\/\*?)?${WHOLE_TARGET_END}/,`;

export const HOME_ARGUMENT = String.raw`/^(?:~|\$HOME|\$\{HOME\})(?:\/+\*?)?$/`;

const RECURSIVE_FLAG = String.raw`/^-[a-zA-Z]*[rR][a-zA-Z]*$/`;

export const rmSafetyPatches: readonly Patch[] = [
  {
    name: 'rm-hard-block-whole-home-target',
    find: HARD_BLOCK_STOCK,
    replace: HARD_BLOCK_WHOLE_TARGET,
  },
  {
    name: 'rm-protected-target-any-home-spelling',
    find: 'homeExpansionIsKnown:n},i){if(!e)return!1;',
    lookups: ['function P(e){return no(e,Le)?void 0:Zt(e)}'],
    replace: `homeExpansionIsKnown:n},i){if(!e)return!1;if(e.some(($ODa)=>Zt($ODa)==="--recursive"||${RECURSIVE_FLAG}.test(Zt($ODa)))&&e.some(($ODa)=>${HOME_ARGUMENT}.test(Zt($ODa))))return!0;`,
  },
  {
    name: 'rm-protected-target-braced-home-parses',
    find: String.raw`let s=e[i];if(s==="\\")return!1;if(t){if(s===t)t=""}else if(s==="'"||s==='"')t=s,n=!0;else if(/[(){}<>\r]/.test(s)`,
    replace: String.raw`let s=e[i];if(s==="\\")return!1;if(t){if(s===t)t=""}else if(s==="'"||s==='"')t=s,n=!0;else if(s==="$"&&e.startsWith("{HOME}",i+1))i+=6,n=!0;else if(/[(){}<>\r]/.test(s)`,
  },
];
