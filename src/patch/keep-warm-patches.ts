import type { Patch } from './patches.ts';

export const KEEP_WARM_COMMAND = 'keep-warm';
export const KEEP_WARM_USAGE = `Usage: /${KEEP_WARM_COMMAND} [on|off]`;
export const KEEP_WARM_ON = 'Keep warm on for this session';
export const KEEP_WARM_OFF = 'Keep warm off for this session';

const COMMAND_DESCRIPTION = 'Keep the prompt cache warm while this session is idle (on or off)';

const CATALOG_ENTRY =
  `${JSON.stringify(KEEP_WARM_COMMAND)}:{name:${JSON.stringify(KEEP_WARM_COMMAND)},` +
  `description:${JSON.stringify(COMMAND_DESCRIPTION)},category:"config"},`;

const COMMAND =
  `${JSON.stringify(KEEP_WARM_COMMAND)}:Gc({name:${JSON.stringify(KEEP_WARM_COMMAND)},description:${JSON.stringify(COMMAND_DESCRIPTION)},` +
  'execute:($ODargs,$ODctx)=>{$ODctx.addEphemeralSystemMessage(globalThis.__odKeepWarm($ODargs[0]),' +
  '{messageType:"system_notification",visibility:"user_only"});return{handled:!0}}}),';

export const keepWarmPatches: readonly Patch[] = [
  {
    name: 'keep-warm-command-catalog',
    find: 'category:"config"},workstreams:{name:"workstreams"',
    replace: `category:"config"},${CATALOG_ENTRY}workstreams:{name:"workstreams"`,
  },
  {
    name: 'keep-warm-command',
    find: 'themes:Ts,tree:Bs,',
    lookups: ['Cs=Gc({name:"vim"'],
    replace: `themes:Ts,tree:Bs,${COMMAND}`,
  },
  {
    name: 'keep-warm-command-busy',
    find: 'tree:"idle-only",settings:"immediate",',
    replace: `tree:"idle-only",${JSON.stringify(KEEP_WARM_COMMAND)}:"immediate",settings:"immediate",`,
  },
];
