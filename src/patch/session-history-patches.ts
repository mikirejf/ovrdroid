import type { Patch } from './patches.ts';

const NO_AUTO_LOAD_PREFIX = 'new Set(["daemon.load_session",';

export const sessionHistoryPatches: readonly Patch[] = [
  {
    name: 'session-history-read-without-runtime-load',
    find: NO_AUTO_LOAD_PREFIX,
    replace: `${NO_AUTO_LOAD_PREFIX}"daemon.get_session_messages",`,
  },
];
