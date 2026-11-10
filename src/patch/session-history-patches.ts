import type { Patch } from './patches.ts';

const NO_AUTO_LOAD_PREFIX =
  'new Set(["daemon.load_session","daemon.initialize_session","daemon.close_session","daemon.interrupt_session","daemon.answer_elicitation","daemon.archive_session","daemon.unarchive_session","daemon.rename_session","daemon.get_session_turn_outcome",';

export const sessionHistoryPatches: readonly Patch[] = [
  {
    name: 'session-history-read-without-runtime-load',
    find: NO_AUTO_LOAD_PREFIX,
    replace: `${NO_AUTO_LOAD_PREFIX}"daemon.get_session_messages",`,
  },
];
