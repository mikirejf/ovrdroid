import type { Patch } from './patches.ts';

const SURFACE_GATE =
  '{toolName:e,surface:o,policy:t}){if(o==="direct")return t.mode!=="script_only"||';

const SCRIPT_MODEL_GATE = 'if(!(r?.some((u)=>u===t.modelId||u===i)??!1))';

export const toolSurfacePatches: readonly Patch[] = [
  {
    name: 'script-mode-sonnet',
    find: SCRIPT_MODEL_GATE,
    replace:
      'if(!((r?.some((u)=>u===t.modelId||u===i)??!1)||(t.modelId+i).toLowerCase().includes("sonnet")))',
  },
  {
    name: 'direct-tools',
    find: SURFACE_GATE,
    replace: `${SURFACE_GATE}["TodoWrite","Read","Grep"].includes(e)||`,
  },
];
