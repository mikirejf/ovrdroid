import type { Patch } from './patches.ts';

const SAME_TODOS =
  'function $ODkeepTodos($ODold,$ODnew){' +
  'if($ODold===null||$ODnew===null)return $ODnew;' +
  'let $ODa=$ODold.todos,$ODb=$ODnew.todos;' +
  'return $ODa.length===$ODb.length&&$ODa.every(($ODt,$ODi)=>{' +
  'let $ODu=$ODb[$ODi],$ODk=Object.keys($ODt);' +
  'return $ODk.length===Object.keys($ODu).length&&$ODk.every(($ODj)=>Object.hasOwn($ODu,$ODj)&&$ODt[$ODj]===$ODu[$ODj])})?$ODold:$ODnew}';

export const todoRenderPatches: readonly Patch[] = [
  {
    name: 'todo-snapshot-stable',
    find: 'V=Wke(L);return A.lastVersion=E,A.lastOutput=V,V}}',
    replace: `V=Wke(L);return V=$ODkeepTodos(A.lastOutput,V),A.lastVersion=E,A.lastOutput=V,V}}${SAME_TODOS}`,
  },
  {
    name: 'todo-panel-memo',
    find: 'function eG({todos:g,width:y,maxVisibleRows:S}){',
    lookups: ['var yD=Bg(({groupedMessages:g,'],
    replace: 'eG=Bg(eG);function eG({todos:g,width:y,maxVisibleRows:S}){',
  },
];
