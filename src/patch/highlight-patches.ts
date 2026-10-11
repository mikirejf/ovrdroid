import type { Patch } from './patches.ts';

export const HIGHLIGHT_MEMO_ENTRIES = 2000;

export const HIGHLIGHT_MEMO_CHARS = 4_000_000;

const SPAN_BODY = 'let e=v_,n=(p,u)=>{if(!u)return p;if(u.startsWith("#"))return V.hex(u)(p)';

function remember(owner: string, key: string, value: string): string {
  return (
    `let $ODcost=${key}.length+${value}.length;` +
    `if($ODmemo.size>=${HIGHLIGHT_MEMO_ENTRIES}||${owner}.$ODchars+$ODcost>${HIGHLIGHT_MEMO_CHARS}){$ODmemo.clear();${owner}.$ODchars=0}` +
    `${owner}.$ODchars+=$ODcost;return $ODmemo.set(${key},${value}),${value}}`
  );
}

export const highlightPatches: readonly Patch[] = [
  {
    name: 'code-highlight-memo',
    find: 'function y(r,e){let{default:n}=import.meta.require(',
    replace: `function y($ODcode,$ODlanguage){let $ODmemo=y.$ODmemo??=(y.$ODchars=0,new Map),$ODkey=$ODlanguage+"\\n"+$ODcode,$ODhit=$ODmemo.get($ODkey);if($ODhit!==void 0)return $ODhit;let $ODhtml=$ODhighlight($ODcode,$ODlanguage);${remember('y', '$ODkey', '$ODhtml')}function $ODhighlight(r,e){let{default:n}=import.meta.require(`,
  },
  {
    name: 'code-ansi-memo',
    find: `function S(r){${SPAN_BODY}`,
    lookups: ['d=()=>wn().getSyntaxColors(),v_=new Proxy'],
    replace: `function S($ODhtml){let $ODcolors=d(),$ODlevel=V.level;if(S.$ODcolors!==$ODcolors||S.$ODlevel!==$ODlevel){S.$ODcolors=$ODcolors;S.$ODlevel=$ODlevel;S.$ODmemo=new Map;S.$ODchars=0}let $ODmemo=S.$ODmemo,$ODhit=$ODmemo.get($ODhtml);if($ODhit!==void 0)return $ODhit;let $ODansi=$ODspans($ODhtml);${remember('S', '$ODhtml', '$ODansi')}function $ODspans(r){${SPAN_BODY}`,
  },
];
