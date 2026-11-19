import type { Patch } from './patches.ts';

const WRAP = ['X1<=0?b1.length-1:X1-1', 'X1>=b1.length-1?0:X1+1'] as const;

const STOP = ['Math.max(0,X1-1)', 'Math.min(b1.length-1,X1+1)'] as const;

const SUGGESTIONS_OPEN = 'let{showSuggestions:l1,suggestions:b1}=H();if(l1&&b1.length>0){';

const COMMANDS_OPEN = 'let{showCommands:l1,filteredCommands:b1}=H();if(l1&&b1.length>0){';

const REMEMBER_DRAFT =
  ',Y1.current={input:Pe.getState().active.text,cursorPosition:Pe.getState().active.cursor}';

function arrowKeys(up: string, down: string, afterMove = ''): string {
  return (
    `if(I(R1,"upArrow"))return x2((X1)=>${up})${afterMove},!0;` +
    `if(I(R1,"downArrow"))return x2((X1)=>${down})${afterMove},!0;`
  );
}

export const suggestionListPatches: readonly Patch[] = [
  {
    name: 'suggestion-list-no-wrap',
    find: SUGGESTIONS_OPEN + arrowKeys(...WRAP),
    replace: SUGGESTIONS_OPEN + arrowKeys(...STOP),
  },
  {
    name: 'command-menu-no-wrap',
    find: COMMANDS_OPEN + arrowKeys(...WRAP, REMEMBER_DRAFT),
    replace: COMMANDS_OPEN + arrowKeys(...STOP, REMEMBER_DRAFT),
  },
];
