import type { Patch } from './patches.ts';

export const todoRenderPatches: readonly Patch[] = [
  {
    name: 'todo-panel-memo',
    find: 'function eG({todos:g,width:y,maxVisibleRows:S}){',
    lookups: ['var yD=Bg(({groupedMessages:g,'],
    replace: 'eG=Bg(eG);function eG({todos:g,width:y,maxVisibleRows:S}){',
  },
];
