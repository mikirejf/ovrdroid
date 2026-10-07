import type { Patch } from './patches.ts';

const GUIDANCE =
  'Anthropic switched this reply to a backup model partway through (server-side fallback, which your proxy turns on). ' +
  'Droid saved the reply without the switch marker, so Anthropic now rejects any request that sends it back. ' +
  'Your settings and model are fine. Rewind to before that reply with /rewind-conversation, or start a new session.';

const THINKING_REPLAY_TEXT = 'blocks in the latest assistant message cannot be modified';

export const errorPatches: readonly Patch[] = [
  {
    name: 'explain-thinking-replay-rejection',
    find: 'if(f==="400")return{key:"errors:agent.byokError400",params:{message:l,detailSuffix:E}}',
    replace:
      `if(l.includes(${JSON.stringify(THINKING_REPLAY_TEXT)}))return{key:"errors:agent.byokErrorProviderMismatch",params:{message:l,detailSuffix:E,guidance:${JSON.stringify(GUIDANCE)}}};` +
      'if(f==="400")return{key:"errors:agent.byokError400",params:{message:l,detailSuffix:E}}',
  },
];
