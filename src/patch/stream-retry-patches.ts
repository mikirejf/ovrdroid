import type { Patch } from './patches.ts';

export const streamRetryPatches: readonly Patch[] = [
  {
    name: 'retry-cut-off-custom-replies',
    find: 'function Om(t){if(!nF(t))return;throw new LT({cause:oF(t)})}',
    replace:
      'function Om(t){if(t.sawTerminalEvent||t.wasAborted)return;throw new LT({cause:oF(t)})}',
  },
];
