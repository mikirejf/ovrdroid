import { SUBAGENT_SOUND_FILE } from '../paths.ts';
import type { Patch } from './patches.ts';

const SUBAGENT_SOUND_PATH = `process.env.HOME+"/.factory/sounds/${SUBAGENT_SOUND_FILE}"`;

export const subagentSoundPatches: readonly Patch[] = [
  {
    name: 'turn-end-sound-takes-subagent-flag',
    find: 'function aee(n){o=n}function dw(){l?.()}function oee(){o?.()}',
    replace: 'function aee(n){o=n}function dw(){l?.()}function oee($ODbusy){o?.($ODbusy)}',
  },
  {
    name: 'turn-end-reports-running-subagents',
    find: 'return P().subscribeToSessionNotifications(Bn,(ke)=>{if(ke.type==="agent_turn_completed"&&ke.reason!=="cancelled")oee()})}',
    lookups: ['let E=P().getSessionStateManager(),A=()=>y?IZ(E,y):0'],
    replace:
      'return P().subscribeToSessionNotifications(Bn,(ke)=>{if(ke.type==="agent_turn_completed"&&ke.reason!=="cancelled")oee(IZ(P().getSessionStateManager(),Bn)>0)})}',
  },
  {
    name: 'turn-end-sound-waits-for-subagents',
    find: 'aee(()=>{let o=f(),r=o.getCompletionSound();if(r==="off")return;let i=o.getSoundFocusMode();M9(r,{},i).catch(()=>{})});',
    replace: `aee(($ODbusy)=>{let o=f(),r=o.getCompletionSound();if(r==="off")return;let i=o.getSoundFocusMode();M9($ODbusy?${SUBAGENT_SOUND_PATH}:r,{},i).catch(()=>{})});`,
  },
];
