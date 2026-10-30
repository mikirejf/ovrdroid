import type { Patch } from './patches.ts';

const WRAPPING_KEYS =
  'if(N(We,"upArrow"))return Nt(($n)=>$n<=0?en.length-1:$n-1),!0;if(N(We,"downArrow"))return Nt(($n)=>$n>=en.length-1?0:$n+1),!0;';

const STOPPING_KEYS =
  'if(N(We,"upArrow"))return Nt(($n)=>Math.max(0,$n-1)),!0;if(N(We,"downArrow"))return Nt(($n)=>Math.min(en.length-1,$n+1)),!0;';

const SUGGESTIONS_OPEN = 'let{showSuggestions:xt,suggestions:en}=A();if(xt&&en.length>0){';

const COMMANDS_OPEN = 'let{showCommands:xt,filteredCommands:en}=A();if(xt&&en.length>0){';

const REMEMBER_DRAFT = 'Rt.current={input:it.current,cursorPosition:ot.current}';

const COMMAND_WRAPPING_KEYS =
  `if(N(We,"upArrow"))return Nt(($n)=>$n<=0?en.length-1:$n-1),${REMEMBER_DRAFT},!0;` +
  `if(N(We,"downArrow"))return Nt(($n)=>$n>=en.length-1?0:$n+1),${REMEMBER_DRAFT},!0;`;

const COMMAND_STOPPING_KEYS =
  `if(N(We,"upArrow"))return Nt(($n)=>Math.max(0,$n-1)),${REMEMBER_DRAFT},!0;` +
  `if(N(We,"downArrow"))return Nt(($n)=>Math.min(en.length-1,$n+1)),${REMEMBER_DRAFT},!0;`;

export const suggestionListPatches: readonly Patch[] = [
  {
    name: 'suggestion-list-no-wrap',
    find: SUGGESTIONS_OPEN + WRAPPING_KEYS,
    replace: SUGGESTIONS_OPEN + STOPPING_KEYS,
  },
  {
    name: 'command-menu-no-wrap',
    find: COMMANDS_OPEN + COMMAND_WRAPPING_KEYS,
    replace: COMMANDS_OPEN + COMMAND_STOPPING_KEYS,
  },
];
