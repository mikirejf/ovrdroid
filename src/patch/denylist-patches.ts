import type { Patch } from './patches.ts';
import { rmSafetyPatches } from './rm-safety-patches.ts';

export const COMMAND_WORD_END = '"(?=[\\\\s;&|)`]|$)"';

const SINGLE_TOKEN_BRANCH = ':"";try{if(e.length===1)';

export const denylistPatches: readonly Patch[] = [
  {
    name: 'denylist-command-word-whole-argument',
    find: `?"\\\\b"${SINGLE_TOKEN_BRANCH}`,
    replace: `?${COMMAND_WORD_END}${SINGLE_TOKEN_BRANCH}`,
  },
  {
    name: 'denylist-quoted-heredoc-body-is-text',
    find: 'return null;let t=Z_(e),o=t.invocations.map(',
    replace: 'return null;let t=Z_(e,{respectHeredocs:!0}),o=t.invocations.map(',
  },
  ...rmSafetyPatches,
];
