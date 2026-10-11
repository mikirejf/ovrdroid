import type { Patch } from './patches.ts';

export const SHARED_CACHE_LINES = 512;

export const WRAP_CACHE_ENTRIES = 2048;

const STYLE_NEIGHBOURS = 'else e+=f(h(t[n-1].styles,o.styles));';

const WRAP_LINE = 'p=_n(h,i,{trim:!1,hard:!0,wordWrap:!1}).split(`\n`)';

export const inkFramePatches: readonly Patch[] = [
  {
    name: 'ink-style-diff-same-skip',
    find: STYLE_NEIGHBOURS,
    replace:
      'else if(t[n-1].styles.length!==o.styles.length||t[n-1].styles.some(($ODs,$ODi)=>$ODs.code!==o.styles[$ODi].code||$ODs.endCode!==o.styles[$ODi].endCode))e+=f(h(t[n-1].styles,o.styles));',
  },
  {
    name: 'ink-output-caches-shared',
    find: 'caches=new BC;',
    replace: `caches=BC.$ODshared!==void 0&&BC.$ODshared.styledChars.size+BC.$ODshared.blockWidths.size<${SHARED_CACHE_LINES}?BC.$ODshared:BC.$ODshared=new BC;`,
  },
  {
    name: 'ink-frame-wrap-cache',
    find: WRAP_LINE,
    lookups: ['Gg=(e,i,l)=>{if(e==="")return[];'],
    replace: `p=(($ODm)=>{let $ODe=$ODm.get(h);if($ODe!==void 0&&$ODe.width===i)return $ODe.lines;let $ODl=_n(h,i,{trim:!1,hard:!0,wordWrap:!1}).split("\\n");if($ODm.size>=${WRAP_CACHE_ENTRIES})$ODm.clear();return $ODm.set(h,{width:i,lines:$ODl}),$ODl})(Gg.$ODwraps??=new Map)`,
  },
];
