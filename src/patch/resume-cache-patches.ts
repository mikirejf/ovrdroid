import type { Patch } from './patches.ts';

export const resumeCachePatches: readonly Patch[] = [
  {
    name: 'tool-result-omit-false-is-error',
    find: '"unknown_tool_id"};if(s.isError!==void 0)r.is_error=s.isError;',
    replace: '"unknown_tool_id"};if(s.isError===!0)r.is_error=!0;',
  },
];
