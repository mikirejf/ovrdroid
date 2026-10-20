import type { Patch } from './patches.ts';

const SURFACE_GATE =
  '{toolName:e,surface:o,policy:t}){if(o==="direct")return t.mode!=="script_only"||';

export const toolSurfacePatches: readonly Patch[] = [
  {
    name: 'todo-write-direct',
    find: SURFACE_GATE,
    replace: `${SURFACE_GATE}e==="TodoWrite"||`,
  },
];
