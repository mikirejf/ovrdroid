import type { Patch } from './patches.ts';

export const copyMenuPatches: readonly Patch[] = [
  {
    name: 'copy-menu-session-id-first',
    find: 'return[{kind:"quick",item:"last-assistant",disabled:!y,label:O.lastAssistant},{kind:"quick",item:"last-user",disabled:!E,label:O.lastUser},{kind:"quick",item:"session-id",disabled:!A,label:O.sessionId},',
    replace:
      'return[{kind:"quick",item:"session-id",disabled:!A,label:O.sessionId},{kind:"quick",item:"last-assistant",disabled:!y,label:O.lastAssistant},{kind:"quick",item:"last-user",disabled:!E,label:O.lastUser},',
  },
];
