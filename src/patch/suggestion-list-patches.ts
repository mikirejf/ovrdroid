import type { Patch } from './patches.ts';

const WRAPPING_KEYS =
  'if(to.upArrow)return kt((Lo)=>Lo<=0?xo.length-1:Lo-1),!0;if(to.downArrow)return kt((Lo)=>Lo>=xo.length-1?0:Lo+1),!0;';

const STOPPING_KEYS =
  'if(to.upArrow)return kt((Lo)=>Math.max(0,Lo-1)),!0;if(to.downArrow)return kt((Lo)=>Math.min(xo.length-1,Lo+1)),!0;';

const SUGGESTIONS_OPEN =
  'Gi=g((Ct,to)=>{let{showSuggestions:vo,suggestions:xo}=G();if(vo&&xo.length>0){';

const COMMANDS_OPEN =
  'li=g((Ct,to)=>{let{showCommands:vo,filteredCommands:xo}=G();if(vo&&xo.length>0){';

export const suggestionListPatches: readonly Patch[] = [
  {
    name: 'suggestion-list-no-wrap',
    find: SUGGESTIONS_OPEN + WRAPPING_KEYS,
    replace: SUGGESTIONS_OPEN + STOPPING_KEYS,
  },
  {
    name: 'command-menu-no-wrap',
    find: COMMANDS_OPEN + WRAPPING_KEYS,
    replace: COMMANDS_OPEN + STOPPING_KEYS,
  },
];
